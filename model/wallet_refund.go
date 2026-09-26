package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	WalletRefundStatusCompleted = "completed"
	WalletRefundStatusPartial   = "partial"
)

// WalletRefund records an administrator-approved refund against one successful
// top-up or redemption source. The idempotency key is globally unique.
type WalletRefund struct {
	Id                 int    `json:"id"`
	UserId             int    `json:"user_id" gorm:"index"`
	SourceType         string `json:"source_type" gorm:"type:varchar(32);index:idx_wallet_refund_source"`
	SourceId           int    `json:"source_id" gorm:"index:idx_wallet_refund_source"`
	SourceRef          string `json:"source_ref" gorm:"type:varchar(255);index"`
	IdempotencyKey     string `json:"idempotency_key" gorm:"uniqueIndex;type:varchar(255)"`
	RequestedQuota     int    `json:"requested_quota"`
	PreviewAmount      int    `json:"preview_amount"`
	PreviewFingerprint string `json:"preview_fingerprint" gorm:"type:varchar(64)"`
	SourceVersion      string `json:"source_version" gorm:"type:varchar(255)"`
	RewardSnapshot     string `json:"reward_snapshot" gorm:"type:text"`
	PromotionCost      int    `json:"promotion_cost"`
	CashRefundQuota    int    `json:"cash_refund_quota"`
	Status             string `json:"status" gorm:"type:varchar(32);index"`
	OperatorId         int    `json:"operator_id" gorm:"index"`
	Reason             string `json:"reason" gorm:"type:varchar(500)"`
	CreatedAt          int64  `json:"created_at"`
}

type WalletRefundPreview struct {
	UserId                  int    `json:"user_id"`
	SourceType              string `json:"source_type"`
	SourceId                int    `json:"source_id"`
	BaseQuota               int    `json:"base_quota"`
	RefundedQuota           int    `json:"refunded_quota"`
	CurrentRefundedQuota    int    `json:"current_refunded_quota"`
	RequestedQuota          int    `json:"requested_quota"`
	RemainingQuota          int    `json:"remaining_quota"`
	SourceVersion           string `json:"source_version"`
	SnapshotFingerprint     string `json:"snapshot_fingerprint"`
	PromotionRewardSnapshot string `json:"promotion_reward_snapshot"`
	PromotionCost           int    `json:"promotion_cost"`
	CashRefundQuota         int    `json:"cash_refund_quota"`
}

type refundRewardSnapshot struct {
	ID                int    `json:"id"`
	BeneficiaryUserID int    `json:"beneficiary_user_id"`
	Level             int    `json:"level"`
	BaseQuota         int    `json:"base_quota"`
	RateBasisPoints   int    `json:"rate_basis_points"`
	RewardQuota       int    `json:"reward_quota"`
	Status            string `json:"status"`
}

type refundSnapshot struct {
	SourceType      string                 `json:"source_type"`
	SourceID        int                    `json:"source_id"`
	UserID          int                    `json:"user_id"`
	BaseQuota       int                    `json:"base_quota"`
	CurrentRefunded int                    `json:"current_refunded"`
	RequestedQuota  int                    `json:"requested_quota"`
	SourceVersion   string                 `json:"source_version"`
	PromotionCost   int                    `json:"promotion_cost"`
	CashRefundQuota int                    `json:"cash_refund_quota"`
	Rewards         []refundRewardSnapshot `json:"rewards"`
}

func refundFingerprint(snapshot refundSnapshot) (string, string, error) {
	rewardBytes, err := common.Marshal(snapshot.Rewards)
	if err != nil {
		return "", "", err
	}
	bytes, err := common.Marshal(snapshot)
	if err != nil {
		return "", "", err
	}
	digest := sha256.Sum256(bytes)
	return hex.EncodeToString(digest[:]), string(rewardBytes), nil
}

func refundableSourceInfoTx(tx *gorm.DB, sourceType string, sourceId int) (userId, baseQuota int, err error) {
	switch sourceType {
	case "topup":
		var source TopUp
		if err = tx.Set("gorm:query_option", "FOR UPDATE").First(&source, sourceId).Error; err != nil {
			return 0, 0, err
		}
		if source.Status != common.TopUpStatusSuccess || source.CreditedQuota <= 0 {
			return 0, 0, errors.New("top-up is not refundable")
		}
		return source.UserId, source.CreditedQuota, nil
	case "redemption":
		var source Redemption
		if err = tx.Set("gorm:query_option", "FOR UPDATE").First(&source, sourceId).Error; err != nil {
			return 0, 0, err
		}
		if source.Status != common.RedemptionCodeStatusUsed || source.Quota <= 0 || source.UsedUserId <= 0 {
			return 0, 0, errors.New("redemption is not refundable")
		}
		return source.UsedUserId, source.Quota, nil
	case "history_migration":
		var total int
		if err = tx.Model(&WalletCashLot{}).Where("source_type = ? AND source_id = ?", sourceType, sourceId).Select("COALESCE(SUM(initial_quota), 0)").Scan(&total).Error; err != nil {
			return 0, 0, err
		}
		if total <= 0 {
			return 0, 0, errors.New("historical migration is not refundable")
		}
		return sourceId, total, nil
	default:
		return 0, 0, errors.New("unsupported refund source")
	}
}

func PreviewWalletRefund(sourceType string, sourceId, amount int) (*WalletRefundPreview, error) {
	if amount <= 0 {
		return nil, errors.New("refund amount must be positive")
	}
	var preview WalletRefundPreview
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		userId, base, err := refundableSourceInfoTx(tx, sourceType, sourceId)
		if err != nil {
			return err
		}
		previous, err := sourceRefundedQuotaTx(tx, sourceType, sourceId)
		if err != nil {
			return err
		}
		if previous+amount > base {
			return errors.New("refund exceeds source quota")
		}
		var rewards []PromotionReward
		if err = tx.Where("source_type = ? AND source_id = ? AND status = ? AND reward_quota > 0", sourceType, sourceId, PromotionRewardCredited).Find(&rewards).Error; err != nil {
			return err
		}
		promotionCost := 0
		rewardSnapshots := make([]refundRewardSnapshot, 0, len(rewards))
		for _, reward := range rewards {
			promotionCost += (previous+amount)*reward.RateBasisPoints/10000 - previous*reward.RateBasisPoints/10000
			rewardSnapshots = append(rewardSnapshots, refundRewardSnapshot{ID: reward.Id, BeneficiaryUserID: reward.BeneficiaryUserId, Level: reward.Level, BaseQuota: reward.BaseQuota, RateBasisPoints: reward.RateBasisPoints, RewardQuota: reward.RewardQuota, Status: reward.Status})
		}
		version, err := refundSourceVersionTx(tx, sourceType, sourceId, base)
		if err != nil {
			return err
		}
		snapshot := refundSnapshot{SourceType: sourceType, SourceID: sourceId, UserID: userId, BaseQuota: base, CurrentRefunded: previous, RequestedQuota: amount, SourceVersion: version, PromotionCost: promotionCost, CashRefundQuota: amount - promotionCost, Rewards: rewardSnapshots}
		fingerprint, rewardJSON, err := refundFingerprint(snapshot)
		if err != nil {
			return err
		}
		preview = WalletRefundPreview{UserId: userId, SourceType: sourceType, SourceId: sourceId, BaseQuota: base, RefundedQuota: previous, CurrentRefundedQuota: previous, RequestedQuota: amount, RemainingQuota: base - previous, SourceVersion: version, SnapshotFingerprint: fingerprint, PromotionRewardSnapshot: rewardJSON, PromotionCost: promotionCost, CashRefundQuota: amount - promotionCost}
		return nil
	})
	return &preview, err
}

func refundSourceVersionTx(tx *gorm.DB, sourceType string, sourceId, base int) (string, error) {
	switch sourceType {
	case "topup":
		var source TopUp
		if err := tx.Select("id, status, credited_quota, refunded_quota, settled_at").First(&source, sourceId).Error; err != nil {
			return "", err
		}
		return fmt.Sprintf("topup:%d:%s:%d:%d:%d", source.Id, source.Status, source.CreditedQuota, source.RefundedQuota, source.SettledAt), nil
	case "redemption":
		var source Redemption
		if err := tx.Select("id, status, quota, refunded_quota, redeemed_time").First(&source, sourceId).Error; err != nil {
			return "", err
		}
		return fmt.Sprintf("redemption:%d:%d:%d:%d:%d", source.Id, source.Status, source.Quota, source.RefundedQuota, source.RedeemedTime), nil
	case "history_migration":
		var row struct {
			Total    int
			Refunded int
			MaxID    int
		}
		if err := tx.Model(&WalletCashLot{}).Where("source_type = ? AND source_id = ?", sourceType, sourceId).Select("COALESCE(SUM(initial_quota), 0) AS total, COALESCE(SUM(refunded_quota), 0) AS refunded, COALESCE(MAX(id), 0) AS max_id").Scan(&row).Error; err != nil {
			return "", err
		}
		return fmt.Sprintf("history_migration:%d:%d:%d:%d", sourceId, base, row.Refunded, row.MaxID), nil
	default:
		return "", errors.New("unsupported refund source")
	}
}

func sourceRefundedQuotaTx(tx *gorm.DB, sourceType string, sourceId int) (int, error) {
	var total int
	err := tx.Model(&WalletRefund{}).Where("source_type = ? AND source_id = ? AND status IN ?", sourceType, sourceId, []string{WalletRefundStatusCompleted, WalletRefundStatusPartial}).Select("COALESCE(SUM(requested_quota), 0)").Scan(&total).Error
	return total, err
}

func debitPromotionTx(tx *gorm.DB, userId, quota, operatorId, operationId int, sourceRef, reason string) error {
	if quota <= 0 {
		return nil
	}
	user, err := lockWalletUser(tx, userId)
	if err != nil {
		return err
	}
	if user.AffQuota < quota {
		return fmt.Errorf("promotion balance is insufficient for user %d", userId)
	}
	if err = tx.Model(&User{}).Where("id = ? AND aff_quota >= ?", userId, quota).Update("aff_quota", gorm.Expr("aff_quota - ?", quota)).Error; err != nil {
		return err
	}
	return tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountPromotion, Direction: WalletDirectionDebit, Amount: quota, BalanceAfter: user.AffQuota - quota, BusinessType: WalletBusinessAdminRefund, SourceType: "refund", SourceRef: sourceRef, OperationId: operationId, OperatorId: operatorId, Reason: reason, CreatedAt: common.GetTimestamp()}).Error
}

func debitRefundableCashLotsTx(tx *gorm.DB, userId, sourceId, amount, operatorId, operationId int, sourceType, sourceRef, reason string) error {
	if amount <= 0 {
		return nil
	}
	user, err := lockWalletUser(tx, userId)
	if err != nil {
		return err
	}
	var lots []WalletCashLot
	if err = tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ? AND source_type = ? AND source_id = ? AND refundable = ? AND initial_quota - consumed_quota - refunded_quota > 0", userId, sourceType, sourceId, true).Order("created_at asc").Order("id asc").Find(&lots).Error; err != nil {
		return err
	}
	available := 0
	for _, lot := range lots {
		available += lot.InitialQuota - lot.ConsumedQuota - lot.RefundedQuota
	}
	if available < amount || user.CashQuota < amount {
		return errors.New("refundable cash balance is insufficient")
	}
	left := amount
	cashAfter := user.CashQuota
	for _, lot := range lots {
		lotAvailable := lot.InitialQuota - lot.ConsumedQuota - lot.RefundedQuota
		if lotAvailable <= 0 {
			continue
		}
		take := minInt(lotAvailable, left)
		if err = tx.Model(&WalletCashLot{}).Where("id = ? AND initial_quota - consumed_quota - refunded_quota >= ?", lot.Id, take).Update("refunded_quota", gorm.Expr("refunded_quota + ?", take)).Error; err != nil {
			return err
		}
		cashAfter -= take
		if err = tx.Create(&WalletTransaction{UserId: userId, AccountType: WalletAccountCash, Direction: WalletDirectionDebit, Amount: take, BalanceAfter: cashAfter, BusinessType: WalletBusinessAdminRefund, SourceType: sourceType, SourceId: sourceId, SourceRef: sourceRef, OperationId: operationId, OperatorId: operatorId, Reason: reason, CreatedAt: common.GetTimestamp()}).Error; err != nil {
			return err
		}
		left -= take
		if left == 0 {
			break
		}
	}
	if left != 0 {
		return errors.New("refundable cash lot allocation incomplete")
	}
	return tx.Model(&User{}).Where("id = ? AND cash_quota >= ? AND quota >= ?", userId, amount, amount).Updates(map[string]interface{}{"cash_quota": gorm.Expr("cash_quota - ?", amount), "quota": gorm.Expr("quota - ?", amount)}).Error
}

// RefundWalletSource performs an administrator-only partial or full refund.
// The user loses the refunded cash, while already-issued promotion rewards are
// clawed back according to cumulative refunded quota.
func RefundWalletSource(sourceType string, sourceId, amount, operatorId int, idempotencyKey, reason string, previewFingerprint ...string) (*WalletRefund, error) {
	if amount <= 0 || idempotencyKey == "" || operatorId <= 0 {
		return nil, errors.New("invalid refund request")
	}
	var refund WalletRefund
	err := DB.Transaction(func(tx *gorm.DB) error {
		var existing WalletRefund
		if err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err == nil {
			refund = existing
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		userId, baseQuota, err := refundableSourceInfoTx(tx, sourceType, sourceId)
		if err != nil {
			return err
		}
		previous, err := sourceRefundedQuotaTx(tx, sourceType, sourceId)
		if err != nil {
			return err
		}
		if previous+amount > baseQuota {
			return errors.New("refund exceeds source quota")
		}
		var rewards []PromotionReward
		if err = tx.Where("source_type = ? AND source_id = ? AND status = ? AND reward_quota > 0", sourceType, sourceId, PromotionRewardCredited).Order("level asc").Find(&rewards).Error; err != nil {
			return err
		}
		promotionCost := 0
		rewardSnapshots := make([]refundRewardSnapshot, 0, len(rewards))
		for _, reward := range rewards {
			before := previous * reward.RateBasisPoints / 10000
			after := (previous + amount) * reward.RateBasisPoints / 10000
			delta := after - before
			if delta <= 0 {
				continue
			}
			if err = debitPromotionTx(tx, reward.BeneficiaryUserId, delta, operatorId, 0, fmt.Sprintf("%s:%d", sourceType, sourceId), reason); err != nil {
				return err
			}
			promotionCost += delta
			rewardSnapshots = append(rewardSnapshots, refundRewardSnapshot{ID: reward.Id, BeneficiaryUserID: reward.BeneficiaryUserId, Level: reward.Level, BaseQuota: reward.BaseQuota, RateBasisPoints: reward.RateBasisPoints, RewardQuota: reward.RewardQuota, Status: reward.Status})
		}
		version, err := refundSourceVersionTx(tx, sourceType, sourceId, baseQuota)
		if err != nil {
			return err
		}
		snapshot := refundSnapshot{SourceType: sourceType, SourceID: sourceId, UserID: userId, BaseQuota: baseQuota, CurrentRefunded: previous, RequestedQuota: amount, SourceVersion: version, PromotionCost: promotionCost, CashRefundQuota: amount - promotionCost, Rewards: rewardSnapshots}
		fingerprint, rewardJSON, err := refundFingerprint(snapshot)
		if err != nil {
			return err
		}
		if len(previewFingerprint) > 0 && previewFingerprint[0] != "" && previewFingerprint[0] != fingerprint {
			return errors.New("refund preview is stale")
		}
		if err = debitRefundableCashLotsTx(tx, userId, sourceId, amount, operatorId, 0, sourceType, fmt.Sprintf("%s:%d", sourceType, sourceId), reason); err != nil {
			return err
		}
		status := WalletRefundStatusPartial
		if previous+amount == baseQuota {
			status = WalletRefundStatusCompleted
		}
		refund = WalletRefund{UserId: userId, SourceType: sourceType, SourceId: sourceId, IdempotencyKey: idempotencyKey, RequestedQuota: amount, PreviewAmount: amount, PreviewFingerprint: fingerprint, SourceVersion: version, RewardSnapshot: rewardJSON, PromotionCost: promotionCost, CashRefundQuota: amount - promotionCost, Status: status, OperatorId: operatorId, Reason: reason, CreatedAt: common.GetTimestamp()}
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "idempotency_key"}}, DoNothing: true}).Create(&refund)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return tx.Where("idempotency_key = ?", idempotencyKey).First(&refund).Error
		}
		if sourceType == "topup" {
			return tx.Model(&TopUp{}).Where("id = ?", sourceId).Updates(map[string]interface{}{"refunded_quota": gorm.Expr("refunded_quota + ?", amount), "refund_status": status}).Error
		}
		if sourceType == "history_migration" {
			return nil
		}
		return tx.Model(&Redemption{}).Where("id = ?", sourceId).Updates(map[string]interface{}{"refunded_quota": gorm.Expr("refunded_quota + ?", amount), "refund_status": status}).Error
	})
	if err == nil {
		invalidateWalletUserCache(refund.UserId, nil)
	}
	return &refund, err
}
