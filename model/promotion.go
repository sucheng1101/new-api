package model

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	PromotionLevel1BasisPointsKey     = "PromotionLevel1BasisPoints"
	PromotionLevel2BasisPointsKey     = "PromotionLevel2BasisPoints"
	PromotionDefaultLevel1BasisPoints = 500
	PromotionDefaultLevel2BasisPoints = 300
)

const (
	PromotionRewardCredited    = "credited"
	PromotionRewardFrozen      = "frozen"
	PromotionRewardVoided      = "voided"
	PromotionRewardRoundedZero = "rounded_zero"
)

// PromotionReward is an immutable snapshot of one reward level for one source.
// The source/level unique key makes payment callbacks and redemption retries safe.
type PromotionReward struct {
	Id                int    `json:"id"`
	SourceType        string `json:"source_type" gorm:"type:varchar(64);uniqueIndex:idx_promotion_reward_source_level"`
	SourceId          int    `json:"source_id" gorm:"uniqueIndex:idx_promotion_reward_source_level"`
	SourceRef         string `json:"source_ref" gorm:"type:varchar(255);index"`
	PayerUserId       int    `json:"payer_user_id" gorm:"index"`
	BeneficiaryUserId int    `json:"beneficiary_user_id" gorm:"index"`
	Level             int    `json:"level" gorm:"uniqueIndex:idx_promotion_reward_source_level"`
	BaseQuota         int    `json:"base_quota"`
	RateBasisPoints   int    `json:"rate_basis_points"`
	RewardQuota       int    `json:"reward_quota"`
	Status            string `json:"status" gorm:"type:varchar(32);index"`
	OperationId       int    `json:"operation_id" gorm:"index"`
	CreatedAt         int64  `json:"created_at"`
	UpdatedAt         int64  `json:"updated_at"`
}

type PromotionRelationAudit struct {
	Id           int    `json:"id"`
	UserId       int    `json:"user_id" gorm:"index"`
	OldInviterId int    `json:"old_inviter_id"`
	NewInviterId int    `json:"new_inviter_id"`
	OperatorId   int    `json:"operator_id" gorm:"index"`
	Reason       string `json:"reason" gorm:"type:varchar(500)"`
	CreatedAt    int64  `json:"created_at" gorm:"index"`
}

type PromotionConfigAudit struct {
	Id                int    `json:"id"`
	Level1BasisPoints int    `json:"level1_basis_points"`
	Level2BasisPoints int    `json:"level2_basis_points"`
	OperatorId        int    `json:"operator_id" gorm:"index"`
	Reason            string `json:"reason" gorm:"type:varchar(500)"`
	CreatedAt         int64  `json:"created_at" gorm:"index"`
}

type PromotionRiskEvent struct {
	Id            int    `json:"id"`
	EventType     string `json:"event_type" gorm:"type:varchar(64);index"`
	UserId        int    `json:"user_id" gorm:"index"`
	RelatedUserId int    `json:"related_user_id" gorm:"index"`
	SourceType    string `json:"source_type" gorm:"type:varchar(64);index"`
	SourceId      int    `json:"source_id"`
	IP            string `json:"ip" gorm:"type:varchar(64);index"`
	RelatedIP     string `json:"related_ip" gorm:"type:varchar(64);index"`
	Message       string `json:"message" gorm:"type:varchar(500)"`
	CreatedAt     int64  `json:"created_at" gorm:"index"`
}

type PromotionSummary struct {
	AffQuota        int `json:"aff_quota"`
	AffHistoryQuota int `json:"aff_history_quota"`
	InvitedCount    int `json:"invited_count"`
	Level1Rate      int `json:"level1_rate_basis_points"`
	Level2Rate      int `json:"level2_rate_basis_points"`
}

func GetPromotionSummary(userId int) (PromotionSummary, error) {
	var user User
	if err := DB.Select("aff_quota", "aff_history", "aff_count").First(&user, userId).Error; err != nil {
		return PromotionSummary{}, err
	}
	level1, level2 := PromotionRates()
	return PromotionSummary{AffQuota: user.AffQuota, AffHistoryQuota: user.AffHistoryQuota, InvitedCount: user.AffCount, Level1Rate: level1, Level2Rate: level2}, nil
}

type PromotionInvitee struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	CreatedAt   int64  `json:"created_at"`
	Level       int    `json:"level"`
	RewardQuota int    `json:"reward_quota"`
}

func ListPromotionInvitees(userId, limit, offset int) ([]PromotionInvitee, int64, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	var direct []User
	if err := DB.Select("id", "username", "created_at").Where("inviter_id = ?", userId).Order("id desc").Find(&direct).Error; err != nil {
		return nil, 0, err
	}
	ids := make([]int, 0, len(direct))
	for _, user := range direct {
		ids = append(ids, user.Id)
	}
	var second []User
	if len(ids) > 0 {
		if err := DB.Select("id", "username", "created_at").Where("inviter_id IN ?", ids).Order("id desc").Find(&second).Error; err != nil {
			return nil, 0, err
		}
	}
	items := make([]PromotionInvitee, 0, len(direct)+len(second))
	appendInvitee := func(user User, level int) error {
		var reward int
		if err := DB.Model(&PromotionReward{}).Where("beneficiary_user_id = ? AND payer_user_id = ?", userId, user.Id).Select("COALESCE(SUM(reward_quota), 0)").Scan(&reward).Error; err != nil {
			return err
		}
		items = append(items, PromotionInvitee{Id: user.Id, Username: maskPromotionUsername(user.Username), CreatedAt: user.CreatedAt, Level: level, RewardQuota: reward})
		return nil
	}
	for _, user := range direct {
		if err := appendInvitee(user, 1); err != nil {
			return nil, 0, err
		}
	}
	for _, user := range second {
		if err := appendInvitee(user, 2); err != nil {
			return nil, 0, err
		}
	}
	total := int64(len(items))
	if offset >= len(items) {
		return []PromotionInvitee{}, total, nil
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end], total, nil
}

func maskPromotionUsername(username string) string {
	runes := []rune(username)
	if len(runes) <= 2 {
		return string(runes[:1]) + "*"
	}
	return string(runes[:1]) + "***" + string(runes[len(runes)-1:])
}

func ListPromotionRewards(userId int, limit, offset int) ([]PromotionReward, int64, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := DB.Model(&PromotionReward{}).Where("beneficiary_user_id = ?", userId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []PromotionReward
	if err := query.Order("id desc").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func SetUserInviterWithAudit(userId, inviterId, operatorId int, reason string) error {
	if reason == "" {
		return errors.New("修改推广关系必须填写原因")
	}
	if userId <= 0 || inviterId == userId {
		return errors.New("无效的推广关系")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Set("gorm:query_option", "FOR UPDATE").First(&user, userId).Error; err != nil {
			return err
		}
		if inviterId != 0 {
			var parent User
			if err := tx.Select("id", "inviter_id").First(&parent, inviterId).Error; err != nil {
				return err
			}
			seen := map[int]bool{userId: true}
			current := parent.Id
			for current != 0 {
				if seen[current] {
					return errors.New("推广关系会形成循环")
				}
				seen[current] = true
				var next User
				if err := tx.Select("id", "inviter_id").First(&next, current).Error; err != nil {
					break
				}
				current = next.InviterId
			}
		}
		old := user.InviterId
		if old == inviterId {
			return nil
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("inviter_id", inviterId).Error; err != nil {
			return err
		}
		return tx.Create(&PromotionRelationAudit{UserId: userId, OldInviterId: old, NewInviterId: inviterId, OperatorId: operatorId, Reason: reason, CreatedAt: common.GetTimestamp()}).Error
	})
	invalidateUserCache(userId)
	return err
}

func ReleasePromotionReward(id, operatorId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var reward PromotionReward
		if err := tx.First(&reward, id).Error; err != nil {
			return err
		}
		if reward.Status != PromotionRewardFrozen {
			return errors.New("promotion reward is not frozen")
		}
		if reward.RewardQuota <= 0 {
			return tx.Model(&reward).Updates(map[string]interface{}{"status": PromotionRewardCredited, "updated_at": common.GetTimestamp()}).Error
		}
		key := fmt.Sprintf("promotion:release:%d", reward.Id)
		if err := CreditPromotionTx(tx, reward.BeneficiaryUserId, reward.RewardQuota, reward.Id, "promotion_release", reward.SourceRef, key, operatorId, "推广奖励释放"); err != nil {
			return err
		}
		var op WalletOperation
		if err := tx.Where("idempotency_key = ?", key).First(&op).Error; err != nil {
			return err
		}
		return tx.Model(&reward).Updates(map[string]interface{}{"status": PromotionRewardCredited, "operation_id": op.Id, "updated_at": common.GetTimestamp()}).Error
	})
}

func VoidPromotionReward(id, operatorId int, reason string) error {
	if reason == "" {
		return errors.New("作废原因不能为空")
	}
	return DB.Model(&PromotionReward{}).Where("id = ? AND status IN ?", id, []string{PromotionRewardFrozen, PromotionRewardCredited}).Updates(map[string]interface{}{"status": PromotionRewardVoided, "updated_at": common.GetTimestamp()}).Error
}

func PromotionRates() (int, int) {
	level1, level2 := PromotionDefaultLevel1BasisPoints, PromotionDefaultLevel2BasisPoints
	common.OptionMapRWMutex.RLock()
	if common.OptionMap != nil {
		if value, err := strconv.Atoi(common.OptionMap[PromotionLevel1BasisPointsKey]); err == nil && value >= 0 && value <= 10000 {
			level1 = value
		}
		if value, err := strconv.Atoi(common.OptionMap[PromotionLevel2BasisPointsKey]); err == nil && value >= 0 && value <= 10000 {
			level2 = value
		}
	}
	common.OptionMapRWMutex.RUnlock()
	if level1+level2 > 10000 {
		return PromotionDefaultLevel1BasisPoints, PromotionDefaultLevel2BasisPoints
	}
	return level1, level2
}

func ValidatePromotionRates(level1, level2 int) error {
	if level1 < 0 || level1 > 10000 || level2 < 0 || level2 > 10000 || level1+level2 > 10000 {
		return errors.New("推广比例必须在 0-10000 基点之间，且合计不超过 10000")
	}
	return nil
}

func promotionAncestors(tx *gorm.DB, payerUserId int) ([]int, error) {
	ancestors := make([]int, 0, 2)
	seen := map[int]bool{payerUserId: true}
	current := payerUserId
	for level := 0; level < 2; level++ {
		var user User
		if err := tx.Select("id", "inviter_id").Where("id = ?", current).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ancestors, nil
			}
			return nil, err
		}
		if user.InviterId <= 0 || seen[user.InviterId] {
			return ancestors, nil
		}
		ancestors = append(ancestors, user.InviterId)
		seen[user.InviterId] = true
		current = user.InviterId
	}
	return ancestors, nil
}

// CreatePromotionRewardsTx creates the level snapshots and credits enabled beneficiaries.
func CreatePromotionRewardsTx(tx *gorm.DB, sourceType string, sourceId int, sourceRef string, payerUserId, baseQuota int) error {
	level1, level2 := PromotionRates()
	return CreatePromotionRewardsWithRatesTx(tx, sourceType, sourceId, sourceRef, payerUserId, baseQuota, level1, level2)
}

func CreatePromotionRewardsWithRatesTx(tx *gorm.DB, sourceType string, sourceId int, sourceRef string, payerUserId, baseQuota, level1, level2 int) error {
	if baseQuota <= 0 {
		return errors.New("promotion base quota must be positive")
	}
	if err := ValidatePromotionRates(level1, level2); err != nil {
		return err
	}
	rates := []int{level1, level2}
	ancestors, err := promotionAncestors(tx, payerUserId)
	if err != nil {
		return err
	}
	now := common.GetTimestamp()
	for index, beneficiaryId := range ancestors {
		level := index + 1
		rate := rates[index]
		rewardQuota := baseQuota * rate / 10000
		status := PromotionRewardCredited
		if rewardQuota <= 0 {
			status = PromotionRewardRoundedZero
		}
		var beneficiary User
		if err = tx.Select("id", "status").Where("id = ?", beneficiaryId).First(&beneficiary).Error; err != nil {
			return err
		}
		if rewardQuota > 0 && beneficiary.Status != common.UserStatusEnabled {
			status = PromotionRewardFrozen
		}
		reward := &PromotionReward{SourceType: sourceType, SourceId: sourceId, SourceRef: sourceRef, PayerUserId: payerUserId, BeneficiaryUserId: beneficiaryId, Level: level, BaseQuota: baseQuota, RateBasisPoints: rate, RewardQuota: rewardQuota, Status: status, CreatedAt: now, UpdatedAt: now}
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "source_type"}, {Name: "source_id"}, {Name: "level"}}, DoNothing: true}).Create(reward)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 || status != PromotionRewardCredited {
			continue
		}
		key := fmt.Sprintf("promotion:%s:%d:%d", sourceType, sourceId, level)
		if err = CreditPromotionTx(tx, beneficiaryId, rewardQuota, sourceId, sourceType, sourceRef, key, 0, fmt.Sprintf("%d级推广返佣", level)); err != nil {
			return err
		}
		var operation WalletOperation
		if err = tx.Where("idempotency_key = ?", key).First(&operation).Error; err != nil {
			return err
		}
		if err = tx.Model(reward).Update("operation_id", operation.Id).Error; err != nil {
			return err
		}
	}
	return nil
}
