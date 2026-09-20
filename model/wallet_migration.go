package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// migrateWalletBalances is deliberately idempotent. Existing quota is treated
// as cash, while historical promotion balance is kept in aff_quota and only
// receives an audit entry. No historical promotion is recalculated.
func migrateWalletBalances() error {
	if DB == nil {
		return nil
	}
	var users []User
	if err := DB.Where("(cash_quota = 0 AND gift_quota = 0 AND quota <> 0) OR aff_quota <> 0").Find(&users).Error; err != nil {
		return err
	}
	for _, user := range users {
		if err := DB.Transaction(func(tx *gorm.DB) error {
			if user.Quota != 0 && user.CashQuota == 0 && user.GiftQuota == 0 {
				key := fmt.Sprintf("history-cash-user-%d", user.Id)
				op, done, err := beginWalletOperation(tx, user.Id, WalletBusinessHistoryMigration, key, user.Quota)
				if err != nil {
					return err
				}
				if !done {
					createdAt := common.GetTimestamp()
					if err := tx.Model(&User{}).Where("id = ? AND cash_quota = 0 AND gift_quota = 0", user.Id).Update("cash_quota", user.Quota).Error; err != nil {
						return err
					}
					if err := tx.Create(&WalletCashLot{UserId: user.Id, SourceType: "history_migration", SourceId: user.Id, SourceRef: key, OperationId: op.Id, InitialQuota: user.Quota, Refundable: true, CreatedAt: createdAt, SuccessAt: createdAt}).Error; err != nil {
						return err
					}
					if err := tx.Create(&WalletTransaction{UserId: user.Id, AccountType: WalletAccountCash, Direction: WalletDirectionCredit, Amount: user.Quota, BalanceAfter: user.Quota, BusinessType: WalletBusinessHistoryMigration, SourceType: "history_migration", SourceId: user.Id, SourceRef: key, OperationId: op.Id, Reason: "历史主余额迁移", CreatedAt: createdAt}).Error; err != nil {
						return err
					}
				}
			}
			if user.AffQuota > 0 {
				key := fmt.Sprintf("history-promotion-user-%d", user.Id)
				var count int64
				if err := tx.Model(&WalletOperation{}).Where("idempotency_key = ?", key).Count(&count).Error; err != nil {
					return err
				}
				if count == 0 {
					op := &WalletOperation{UserId: user.Id, BusinessType: WalletBusinessHistoryMigration, RequestedQuota: user.AffQuota, Status: WalletOpCompleted, IdempotencyKey: key, CreatedAt: common.GetTimestamp()}
					if err := tx.Create(op).Error; err != nil {
						return err
					}
					if err := tx.Create(&WalletTransaction{UserId: user.Id, AccountType: WalletAccountPromotion, Direction: WalletDirectionCredit, Amount: user.AffQuota, BalanceAfter: user.AffQuota, BusinessType: WalletBusinessHistoryMigration, OperationId: op.Id, Reason: "历史推广余额迁移", CreatedAt: common.GetTimestamp()}).Error; err != nil {
						return err
					}
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}
	var invalidCount int64
	if err := DB.Model(&User{}).Where("quota <> cash_quota + gift_quota OR cash_quota < 0 OR gift_quota < 0").Count(&invalidCount).Error; err != nil {
		return err
	}
	if invalidCount > 0 {
		return fmt.Errorf("wallet migration left %d invalid user balances", invalidCount)
	}
	return nil
}
