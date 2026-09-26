package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AdminWalletOperationCashCredit = "cash_credit"
	AdminWalletOperationGiftCredit = "gift_credit"
	AdminWalletOperationDebit      = "debit"
	AdminWalletOperationRefund     = "refund"
	AdminWalletOperationCorrection = "correction"
	AdminWalletOperationCompleted  = "completed"
)

// AdminWalletOperation is the audit record for every administrator balance
// change. WalletOperation remains the idempotency anchor for ledger mutations.
type AdminWalletOperation struct {
	Id             int    `json:"id"`
	UserId         int    `json:"user_id" gorm:"index"`
	OperatorId     int    `json:"operator_id" gorm:"index"`
	OperationType  string `json:"operation_type" gorm:"type:varchar(32);index"`
	AccountType    string `json:"account_type" gorm:"type:varchar(16);index"`
	Amount         int    `json:"amount"`
	IdempotencyKey string `json:"idempotency_key" gorm:"uniqueIndex;type:varchar(255)"`
	Reason         string `json:"reason" gorm:"type:varchar(500)"`
	Status         string `json:"status" gorm:"type:varchar(32);index"`
	CreatedAt      int64  `json:"created_at"`
}

func beginAdminWalletOperationTx(tx *gorm.DB, userId, operatorId, amount int, operationType, accountType, idempotencyKey, reason string) (*AdminWalletOperation, bool, error) {
	if userId <= 0 || operatorId <= 0 || amount <= 0 || idempotencyKey == "" {
		return nil, false, errors.New("invalid administrator wallet operation")
	}
	var existing AdminWalletOperation
	if err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err == nil {
		if existing.UserId != userId || existing.Amount != amount || existing.OperationType != operationType {
			return nil, false, errors.New("administrator wallet idempotency key belongs to another operation")
		}
		return &existing, true, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	op := &AdminWalletOperation{UserId: userId, OperatorId: operatorId, OperationType: operationType, AccountType: accountType, Amount: amount, IdempotencyKey: idempotencyKey, Reason: reason, Status: AdminWalletOperationCompleted, CreatedAt: common.GetTimestamp()}
	result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "idempotency_key"}}, DoNothing: true}).Create(op)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 0 {
		if err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err != nil {
			return nil, false, err
		}
		return &existing, true, nil
	}
	return op, false, nil
}

func AdminCreditWallet(userId, amount, operatorId int, gift bool, idempotencyKey, reason string) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		operationType, accountType, businessType := AdminWalletOperationCashCredit, WalletAccountCash, WalletBusinessAdminCashCredit
		if gift {
			operationType, accountType, businessType = AdminWalletOperationGiftCredit, WalletAccountGift, WalletBusinessAdminGiftCredit
		}
		if _, done, err := beginAdminWalletOperationTx(tx, userId, operatorId, amount, operationType, accountType, idempotencyKey, reason); err != nil || done {
			return err
		}
		if gift {
			return CreditGiftTx(tx, userId, amount, operatorId, "admin", idempotencyKey, businessType, "admin-gift:"+idempotencyKey, operatorId, reason)
		}
		return CreditCashTx(tx, userId, amount, operatorId, "admin", idempotencyKey, businessType, "admin-cash:"+idempotencyKey, false, operatorId, reason)
	})
	invalidateWalletUserCache(userId, err)
	return err
}

// AdminDebitWallet removes gift balance first and then cash balance. Cash
// deductions advance the source lots as an administrator adjustment.
func AdminDebitWallet(userId, amount, operatorId int, idempotencyKey, reason string) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		if _, done, err := beginAdminWalletOperationTx(tx, userId, operatorId, amount, AdminWalletOperationDebit, "wallet", idempotencyKey, reason); err != nil || done {
			return err
		}
		if amount <= 0 {
			return errors.New("debit amount must be positive")
		}
		user, err := lockWalletUser(tx, userId)
		if err != nil {
			return err
		}
		if user.Quota < amount {
			return errors.New("insufficient wallet balance")
		}
		remaining := amount
		createdAt := common.GetTimestamp()
		if take := minInt(user.GiftQuota, remaining); take > 0 {
			if err = tx.Model(&User{}).Where("id = ? AND gift_quota >= ?", userId, take).Updates(map[string]interface{}{"gift_quota": gorm.Expr("gift_quota - ?", take), "quota": gorm.Expr("quota - ?", take)}).Error; err != nil {
				return err
			}
			if err = tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountGift, Direction: WalletDirectionDebit, Amount: take, BalanceAfter: user.GiftQuota - take, BusinessType: WalletBusinessAdminDebit, OperationId: 0, OperatorId: operatorId, Reason: reason, CreatedAt: createdAt}).Error; err != nil {
				return err
			}
			remaining -= take
		}
		if remaining == 0 {
			return nil
		}
		var lots []WalletCashLot
		if err = tx.Where("user_id = ? AND initial_quota - consumed_quota - refunded_quota > 0", userId).Order("created_at asc").Order("id asc").Find(&lots).Error; err != nil {
			return err
		}
		left := remaining
		cashAfter := user.CashQuota
		for _, lot := range lots {
			available := lot.InitialQuota - lot.ConsumedQuota - lot.RefundedQuota
			if available <= 0 {
				continue
			}
			take := minInt(available, left)
			if err = tx.Model(&WalletCashLot{}).Where("id = ? AND initial_quota - consumed_quota - refunded_quota >= ?", lot.Id, take).Update("consumed_quota", gorm.Expr("consumed_quota + ?", take)).Error; err != nil {
				return err
			}
			cashAfter -= take
			if err = tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountCash, Direction: WalletDirectionDebit, Amount: take, BalanceAfter: cashAfter, BusinessType: WalletBusinessAdminDebit, SourceType: "wallet_cash_lot", SourceId: lot.Id, SourceRef: idempotencyKey, OperatorId: operatorId, Reason: reason, CreatedAt: createdAt}).Error; err != nil {
				return err
			}
			left -= take
			if left == 0 {
				break
			}
		}
		if left != 0 {
			return fmt.Errorf("cash lot allocation incomplete")
		}
		return tx.Model(&User{}).Where("id = ? AND cash_quota >= ?", userId, remaining).Updates(map[string]interface{}{"cash_quota": gorm.Expr("cash_quota - ?", remaining), "quota": gorm.Expr("quota - ?", remaining)}).Error
	})
	invalidateWalletUserCache(userId, err)
	return err
}

// AdminCorrectWallet applies a signed correction to either the cash or gift
// account. Positive deltas credit the selected account; negative deltas debit
// it. Cash corrections keep the cash-lot ledger in sync and are never
// refundable when credited.
func AdminCorrectWallet(userId int, accountType string, delta, operatorId int, idempotencyKey, reason string) error {
	if userId <= 0 || operatorId <= 0 || delta == 0 || idempotencyKey == "" || reason == "" {
		return errors.New("invalid administrator wallet correction")
	}
	if accountType != WalletAccountCash && accountType != WalletAccountGift {
		return errors.New("invalid correction account")
	}
	amount := delta
	if amount < 0 {
		amount = -amount
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		op, done, err := beginAdminWalletOperationTx(tx, userId, operatorId, amount, AdminWalletOperationCorrection, accountType, idempotencyKey, reason)
		if err != nil || done {
			return err
		}
		user, err := lockWalletUser(tx, userId)
		if err != nil {
			return err
		}
		createdAt := common.GetTimestamp()
		if delta > 0 {
			if accountType == WalletAccountGift {
				if err = tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{"gift_quota": gorm.Expr("gift_quota + ?", amount), "quota": gorm.Expr("quota + ?", amount)}).Error; err != nil {
					return err
				}
				return tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountGift, Direction: WalletDirectionCredit, Amount: amount, BalanceAfter: user.GiftQuota + amount, BusinessType: WalletBusinessAdminCorrection, SourceType: "admin_correction", SourceRef: idempotencyKey, OperationId: op.Id, OperatorId: operatorId, Reason: reason, CreatedAt: createdAt}).Error
			}
			if err = tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{"cash_quota": gorm.Expr("cash_quota + ?", amount), "quota": gorm.Expr("quota + ?", amount)}).Error; err != nil {
				return err
			}
			if err = tx.Create(&WalletCashLot{UserId: userId, SourceType: "admin_correction", SourceId: op.Id, SourceRef: idempotencyKey, OperationId: op.Id, InitialQuota: amount, Refundable: false, CreatedAt: createdAt, SuccessAt: createdAt}).Error; err != nil {
				return err
			}
			return tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountCash, Direction: WalletDirectionCredit, Amount: amount, BalanceAfter: user.CashQuota + amount, BusinessType: WalletBusinessAdminCorrection, SourceType: "admin_correction", SourceRef: idempotencyKey, OperationId: op.Id, OperatorId: operatorId, Reason: reason, CreatedAt: createdAt}).Error
		}

		if accountType == WalletAccountGift {
			if user.GiftQuota < amount {
				return errors.New("insufficient gift balance")
			}
			if err = tx.Model(&User{}).Where("id = ? AND gift_quota >= ?", userId, amount).Updates(map[string]interface{}{"gift_quota": gorm.Expr("gift_quota - ?", amount), "quota": gorm.Expr("quota - ?", amount)}).Error; err != nil {
				return err
			}
			return tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountGift, Direction: WalletDirectionDebit, Amount: amount, BalanceAfter: user.GiftQuota - amount, BusinessType: WalletBusinessAdminCorrection, SourceType: "admin_correction", SourceRef: idempotencyKey, OperationId: op.Id, OperatorId: operatorId, Reason: reason, CreatedAt: createdAt}).Error
		}

		if user.CashQuota < amount {
			return errors.New("insufficient cash balance")
		}
		var lots []WalletCashLot
		if err = tx.Where("user_id = ? AND initial_quota - consumed_quota - refunded_quota > 0", userId).Order("created_at asc").Order("id asc").Find(&lots).Error; err != nil {
			return err
		}
		left := amount
		cashAfter := user.CashQuota
		for _, lot := range lots {
			available := lot.InitialQuota - lot.ConsumedQuota - lot.RefundedQuota
			if available <= 0 {
				continue
			}
			take := minInt(available, left)
			result := tx.Model(&WalletCashLot{}).Where("id = ? AND initial_quota - consumed_quota - refunded_quota >= ?", lot.Id, take).Update("consumed_quota", gorm.Expr("consumed_quota + ?", take))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("cash lot balance changed")
			}
			cashAfter -= take
			if err = tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountCash, Direction: WalletDirectionDebit, Amount: take, BalanceAfter: cashAfter, BusinessType: WalletBusinessAdminCorrection, SourceType: "admin_correction", SourceId: lot.Id, SourceRef: idempotencyKey, OperationId: op.Id, OperatorId: operatorId, Reason: reason, CreatedAt: createdAt}).Error; err != nil {
				return err
			}
			left -= take
			if left == 0 {
				break
			}
		}
		if left != 0 {
			return errors.New("cash lot allocation incomplete")
		}
		return tx.Model(&User{}).Where("id = ? AND cash_quota >= ?", userId, amount).Updates(map[string]interface{}{"cash_quota": gorm.Expr("cash_quota - ?", amount), "quota": gorm.Expr("quota - ?", amount)}).Error
	})
	invalidateWalletUserCache(userId, err)
	return err
}
