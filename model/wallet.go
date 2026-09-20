package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	WalletAccountCash        = "cash"
	WalletAccountGift        = "gift"
	WalletAccountPromotion   = "promotion"
	WalletDirectionCredit    = "credit"
	WalletDirectionDebit     = "debit"
	WalletOpCompleted        = "completed"
	WalletAllocationActive   = "active"
	WalletAllocationRestored = "restored"
)

const (
	WalletBusinessHistoryMigration = "history_migration"
	WalletBusinessCashCredit       = "cash_credit"
	WalletBusinessGiftCredit       = "gift_credit"
	WalletBusinessPromotionCredit  = "promotion_credit"
	WalletBusinessModelConsume     = "model_consume"
	WalletBusinessModelRefund      = "model_consume_refund"
)

// WalletOperation is the idempotency anchor for every wallet mutation.
// Ledger rows intentionally remain append-only and may contain multiple rows
// for a single operation (for example gift + cash FIFO allocations).
type WalletOperation struct {
	Id             int    `json:"id"`
	UserId         int    `json:"user_id" gorm:"index"`
	IdempotencyKey string `json:"idempotency_key" gorm:"uniqueIndex;type:varchar(255)"`
	BusinessType   string `json:"business_type" gorm:"type:varchar(64);index"`
	RequestedQuota int    `json:"requested_quota"`
	Status         string `json:"status" gorm:"type:varchar(32);index"`
	CreatedAt      int64  `json:"created_at"`
}

// WalletTransaction is an immutable account-level balance entry.
type WalletTransaction struct {
	Id           int    `json:"id"`
	UserId       int    `json:"user_id" gorm:"index"`
	AccountType  string `json:"account_type" gorm:"type:varchar(16);index"`
	Direction    string `json:"direction" gorm:"type:varchar(16)"`
	Amount       int    `json:"amount"`
	BalanceAfter int    `json:"balance_after"`
	BusinessType string `json:"business_type" gorm:"type:varchar(64);index"`
	SourceType   string `json:"source_type" gorm:"type:varchar(64);index"`
	SourceId     int    `json:"source_id"`
	SourceRef    string `json:"source_ref" gorm:"type:varchar(255)"`
	OperationId  int    `json:"operation_id" gorm:"index"`
	OperatorId   int    `json:"operator_id"`
	Reason       string `json:"reason" gorm:"type:varchar(500)"`
	CreatedAt    int64  `json:"created_at"`
}

// WalletCashLot tracks the source and refundable portion of cash balance.
type WalletCashLot struct {
	Id            int    `json:"id"`
	UserId        int    `json:"user_id" gorm:"index"`
	SourceType    string `json:"source_type" gorm:"type:varchar(64);index"`
	SourceId      int    `json:"source_id"`
	SourceRef     string `json:"source_ref" gorm:"type:varchar(255)"`
	OperationId   int    `json:"operation_id" gorm:"index"`
	InitialQuota  int    `json:"initial_quota"`
	ConsumedQuota int    `json:"consumed_quota"`
	RefundedQuota int    `json:"refunded_quota"`
	Refundable    bool   `json:"refundable" gorm:"index"`
	CreatedAt     int64  `json:"created_at" gorm:"index"`
	SuccessAt     int64  `json:"success_at"`
}

// WalletConsumptionAllocation preserves the exact source of a model charge.
type WalletConsumptionAllocation struct {
	Id          int    `json:"id"`
	UserId      int    `json:"user_id" gorm:"index"`
	RequestId   string `json:"request_id" gorm:"index"`
	OperationId int    `json:"operation_id" gorm:"index"`
	AccountType string `json:"account_type" gorm:"type:varchar(16)"`
	CashLotId   int    `json:"cash_lot_id" gorm:"index"`
	Quota       int    `json:"quota"`
	Status      string `json:"status" gorm:"type:varchar(16);index"`
	CreatedAt   int64  `json:"created_at"`
}

// WalletBalance is the split balance returned to callers without exposing
// database implementation details.
type WalletBalance struct {
	Cash      int
	Gift      int
	Promotion int
	Total     int
}

func lockWalletUser(tx *gorm.DB, userId int) (*User, error) {
	var user User
	if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("id = ?", userId).First(&user).Error; err != nil {
		return nil, err
	}
	if user.CashQuota < 0 || user.GiftQuota < 0 {
		return nil, errors.New("wallet balance is negative")
	}
	if user.Quota != user.CashQuota+user.GiftQuota {
		return nil, fmt.Errorf("wallet invariant violated for user %d", user.Id)
	}
	return &user, nil
}

func beginWalletOperation(tx *gorm.DB, userId int, businessType, idempotencyKey string, requestedQuota int) (*WalletOperation, bool, error) {
	if idempotencyKey == "" {
		return nil, false, errors.New("wallet idempotency key is required")
	}
	var existing WalletOperation
	err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error
	if err == nil {
		if existing.UserId != userId || existing.BusinessType != businessType || existing.RequestedQuota != requestedQuota {
			return nil, false, errors.New("wallet idempotency key belongs to another operation")
		}
		return &existing, true, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	op := &WalletOperation{UserId: userId, BusinessType: businessType, RequestedQuota: requestedQuota, Status: WalletOpCompleted, IdempotencyKey: idempotencyKey, CreatedAt: common.GetTimestamp()}
	if err := tx.Create(op).Error; err != nil {
		return nil, false, err
	}
	return op, false, nil
}

func CreditCash(userId, quota, sourceId int, sourceType, sourceRef, businessType, idempotencyKey string, refundable bool, operatorId int, reason string) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		return CreditCashTx(tx, userId, quota, sourceId, sourceType, sourceRef, businessType, idempotencyKey, refundable, operatorId, reason)
	})
	invalidateWalletUserCache(userId, err)
	return err
}

func CreditCashTx(tx *gorm.DB, userId, quota, sourceId int, sourceType, sourceRef, businessType, idempotencyKey string, refundable bool, operatorId int, reason string) error {
	if quota <= 0 {
		return errors.New("cash credit must be positive")
	}
	op, done, err := beginWalletOperation(tx, userId, businessType, idempotencyKey, quota)
	if err != nil || done {
		return err
	}
	user, err := lockWalletUser(tx, userId)
	if err != nil {
		return err
	}
	if err = tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"cash_quota": gorm.Expr("cash_quota + ?", quota),
		"quota":      gorm.Expr("quota + ?", quota),
	}).Error; err != nil {
		return err
	}
	createdAt := common.GetTimestamp()
	if err = tx.Create(&WalletCashLot{UserId: userId, SourceType: sourceType, SourceId: sourceId, SourceRef: sourceRef, OperationId: op.Id, InitialQuota: quota, Refundable: refundable, CreatedAt: createdAt, SuccessAt: createdAt}).Error; err != nil {
		return err
	}
	return tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountCash, Direction: WalletDirectionCredit, Amount: quota, BalanceAfter: user.CashQuota + quota, BusinessType: businessType, SourceType: sourceType, SourceId: sourceId, SourceRef: sourceRef, OperationId: op.Id, OperatorId: operatorId, Reason: reason, CreatedAt: createdAt}).Error
}

func CreditGift(userId, quota, sourceId int, sourceType, sourceRef, businessType, idempotencyKey string, operatorId int, reason string) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		return CreditGiftTx(tx, userId, quota, sourceId, sourceType, sourceRef, businessType, idempotencyKey, operatorId, reason)
	})
	invalidateWalletUserCache(userId, err)
	return err
}

func CreditGiftTx(tx *gorm.DB, userId, quota, sourceId int, sourceType, sourceRef, businessType, idempotencyKey string, operatorId int, reason string) error {
	if quota <= 0 {
		return errors.New("gift credit must be positive")
	}
	op, done, err := beginWalletOperation(tx, userId, businessType, idempotencyKey, quota)
	if err != nil || done {
		return err
	}
	user, err := lockWalletUser(tx, userId)
	if err != nil {
		return err
	}
	if err = tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"gift_quota": gorm.Expr("gift_quota + ?", quota),
		"quota":      gorm.Expr("quota + ?", quota),
	}).Error; err != nil {
		return err
	}
	return tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountGift, Direction: WalletDirectionCredit, Amount: quota, BalanceAfter: user.GiftQuota + quota, BusinessType: businessType, SourceType: sourceType, SourceId: sourceId, SourceRef: sourceRef, OperationId: op.Id, OperatorId: operatorId, Reason: reason, CreatedAt: common.GetTimestamp()}).Error
}

// DebitWalletTx deducts gift first and then cash lots in creation order.
// Every allocation is persisted so a failed request can restore exactly the
// same accounts and lots.
func DebitWalletTx(tx *gorm.DB, userId, quota int, requestId, idempotencyKey string) error {
	if quota <= 0 {
		return nil
	}
	op, done, err := beginWalletOperation(tx, userId, WalletBusinessModelConsume, idempotencyKey, quota)
	if err != nil || done {
		return err
	}
	user, err := lockWalletUser(tx, userId)
	if err != nil {
		return err
	}
	if user.Quota < quota {
		return errors.New("insufficient wallet balance")
	}
	remaining := quota
	createdAt := common.GetTimestamp()
	if take := minInt(user.GiftQuota, remaining); take > 0 {
		if err = tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{"gift_quota": gorm.Expr("gift_quota - ?", take), "quota": gorm.Expr("quota - ?", take)}).Error; err != nil {
			return err
		}
		if err = tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountGift, Direction: WalletDirectionDebit, Amount: take, BalanceAfter: user.GiftQuota - take, BusinessType: WalletBusinessModelConsume, OperationId: op.Id, CreatedAt: createdAt}).Error; err != nil {
			return err
		}
		if err = tx.Create(&WalletConsumptionAllocation{UserId: userId, RequestId: requestId, OperationId: op.Id, AccountType: WalletAccountGift, Quota: take, Status: WalletAllocationActive, CreatedAt: createdAt}).Error; err != nil {
			return err
		}
		remaining -= take
	}
	if remaining == 0 {
		return nil
	}
	lots := make([]WalletCashLot, 0)
	if err = tx.Where("user_id = ? AND initial_quota - consumed_quota - refunded_quota > 0", userId).Order("created_at asc").Order("id asc").Find(&lots).Error; err != nil {
		return err
	}
	availableCash := user.CashQuota
	if availableCash < remaining {
		return errors.New("cash lot balance is inconsistent")
	}
	if err = tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{"cash_quota": gorm.Expr("cash_quota - ?", remaining), "quota": gorm.Expr("quota - ?", remaining)}).Error; err != nil {
		return err
	}
	left := remaining
	cashBalanceAfter := user.CashQuota
	for i := range lots {
		lotAvailable := lots[i].InitialQuota - lots[i].ConsumedQuota - lots[i].RefundedQuota
		if lotAvailable <= 0 {
			continue
		}
		take := minInt(lotAvailable, left)
		if err = tx.Model(&WalletCashLot{}).Where("id = ?", lots[i].Id).Updates(map[string]interface{}{"consumed_quota": gorm.Expr("consumed_quota + ?", take)}).Error; err != nil {
			return err
		}
		cashBalanceAfter -= take
		if err = tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountCash, Direction: WalletDirectionDebit, Amount: take, BalanceAfter: cashBalanceAfter, BusinessType: WalletBusinessModelConsume, SourceType: "wallet_cash_lot", SourceId: lots[i].Id, SourceRef: requestId, OperationId: op.Id, CreatedAt: createdAt}).Error; err != nil {
			return err
		}
		if err = tx.Create(&WalletConsumptionAllocation{UserId: userId, RequestId: requestId, OperationId: op.Id, AccountType: WalletAccountCash, CashLotId: lots[i].Id, Quota: take, Status: WalletAllocationActive, CreatedAt: createdAt}).Error; err != nil {
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
	return nil
}

func DebitWallet(userId, quota int, requestId, idempotencyKey string) error {
	err := DB.Transaction(func(tx *gorm.DB) error { return DebitWalletTx(tx, userId, quota, requestId, idempotencyKey) })
	invalidateWalletUserCache(userId, err)
	return err
}

func RestoreWalletAllocations(userId int, requestId, idempotencyKey string) error {
	err := DB.Transaction(func(tx *gorm.DB) error { return RestoreWalletAllocationsTx(tx, userId, requestId, idempotencyKey) })
	invalidateWalletUserCache(userId, err)
	return err
}

func RestoreWalletAllocationsTx(tx *gorm.DB, userId int, requestId, idempotencyKey string) error {
	op, done, err := beginWalletOperation(tx, userId, WalletBusinessModelRefund, idempotencyKey, 0)
	if err != nil || done {
		return err
	}
	var allocations []WalletConsumptionAllocation
	if err = tx.Where("user_id = ? AND request_id = ? AND status = ?", userId, requestId, WalletAllocationActive).Order("id asc").Find(&allocations).Error; err != nil {
		return err
	}
	if len(allocations) == 0 {
		return errors.New("wallet allocations not found")
	}
	user, err := lockWalletUser(tx, userId)
	if err != nil {
		return err
	}
	cashBalanceAfter := user.CashQuota
	giftBalanceAfter := user.GiftQuota
	for _, allocation := range allocations {
		if allocation.AccountType == WalletAccountGift {
			if err = tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{"gift_quota": gorm.Expr("gift_quota + ?", allocation.Quota), "quota": gorm.Expr("quota + ?", allocation.Quota)}).Error; err != nil {
				return err
			}
			giftBalanceAfter += allocation.Quota
		} else if allocation.AccountType == WalletAccountCash {
			if err = tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{"cash_quota": gorm.Expr("cash_quota + ?", allocation.Quota), "quota": gorm.Expr("quota + ?", allocation.Quota)}).Error; err != nil {
				return err
			}
			cashBalanceAfter += allocation.Quota
			if err = tx.Model(&WalletCashLot{}).Where("id = ?", allocation.CashLotId).Updates(map[string]interface{}{"consumed_quota": gorm.Expr("consumed_quota - ?", allocation.Quota)}).Error; err != nil {
				return err
			}
		}
		balanceAfter := cashBalanceAfter
		if allocation.AccountType == WalletAccountGift {
			balanceAfter = giftBalanceAfter
		}
		if err = tx.Create(&WalletTransaction{UserId: userId, AccountType: allocation.AccountType, Direction: WalletDirectionCredit, Amount: allocation.Quota, BalanceAfter: balanceAfter, BusinessType: WalletBusinessModelRefund, SourceType: "wallet_allocation", SourceId: allocation.Id, SourceRef: requestId, OperationId: op.Id, CreatedAt: common.GetTimestamp()}).Error; err != nil {
			return err
		}
		if err = tx.Model(&WalletConsumptionAllocation{}).Where("id = ?", allocation.Id).Update("status", WalletAllocationRestored).Error; err != nil {
			return err
		}
	}
	return nil
}

func GetWalletBalance(userId int) (WalletBalance, error) {
	var user User
	if err := DB.Select("cash_quota", "gift_quota", "quota", "aff_quota").First(&user, userId).Error; err != nil {
		return WalletBalance{}, err
	}
	if user.Quota != user.CashQuota+user.GiftQuota {
		return WalletBalance{}, fmt.Errorf("wallet invariant violated for user %d", userId)
	}
	return WalletBalance{Cash: user.CashQuota, Gift: user.GiftQuota, Promotion: user.AffQuota, Total: user.Quota}, nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func invalidateWalletUserCache(userId int, mutationErr error) {
	if mutationErr != nil {
		return
	}
	if err := invalidateUserCache(userId); err != nil {
		common.SysLog(fmt.Sprintf("failed to invalidate wallet user cache (userId=%d): %s", userId, err.Error()))
	}
}
