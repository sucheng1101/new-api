package model

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	LotteryThresholdKey      = "LotteryDailyConsumeThreshold"
	LotteryDailyAttemptsKey  = "LotteryDailyAttempts"
	LotteryKeepAttemptsKey   = "LotteryKeepAttempts"
	LotteryInviteRegisterKey = "LotteryInviteRegisterEnabled"
	LotteryInviteRechargeKey = "LotteryInviteRechargeEnabled"
	LotteryPrizeGift         = "gift"
	LotteryPrizeNone         = "none"
)

type LotteryPrize struct {
	Id          int    `json:"id"`
	Name        string `json:"name" gorm:"type:varchar(128);not null"`
	PrizeType   string `json:"prize_type" gorm:"type:varchar(32);not null"`
	RewardQuota int    `json:"reward_quota"`
	Weight      int    `json:"weight"`
	Stock       int    `json:"stock"` // -1 means unlimited
	Enabled     bool   `json:"enabled" gorm:"index"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

type LotteryDaily struct {
	Id              int    `json:"id"`
	UserId          int    `json:"user_id" gorm:"uniqueIndex:idx_lottery_daily_user_day"`
	DayKey          string `json:"day_key" gorm:"type:varchar(16);uniqueIndex:idx_lottery_daily_user_day"`
	ConsumedQuota   int    `json:"consumed_quota"`
	GrantedAttempts int    `json:"granted_attempts"`
	UsedAttempts    int    `json:"used_attempts"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
}

type LotteryDraw struct {
	Id                  int    `json:"id"`
	UserId              int    `json:"user_id" gorm:"index"`
	DayKey              string `json:"day_key" gorm:"type:varchar(16);index"`
	PrizeId             int    `json:"prize_id" gorm:"index"`
	PrizeName           string `json:"prize_name" gorm:"type:varchar(128)"`
	RewardQuota         int    `json:"reward_quota"`
	PoolVersion         string `json:"pool_version" gorm:"type:varchar(64)"`
	CandidateSnapshot   string `json:"candidate_snapshot" gorm:"type:text"`
	WeightSnapshot      string `json:"weight_snapshot" gorm:"type:text"`
	ProbabilitySnapshot string `json:"probability_snapshot" gorm:"type:text"`
	ResultProbability   int    `json:"result_probability"`
	IdempotencyKey      string `json:"idempotency_key" gorm:"uniqueIndex;type:varchar(255)"`
	CreatedAt           int64  `json:"created_at"`
}

type lotteryCandidateSnapshot struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	PrizeType   string `json:"prize_type"`
	RewardQuota int    `json:"reward_quota"`
	Stock       int    `json:"stock"`
	Weight      int    `json:"weight"`
}

type lotteryProbabilitySnapshot struct {
	PrizeID                int `json:"prize_id"`
	Weight                 int `json:"weight"`
	ProbabilityBasisPoints int `json:"probability_basis_points"`
}

type lotteryWeightSnapshot struct {
	PrizeID int `json:"prize_id"`
	Weight  int `json:"weight"`
}

func buildLotterySnapshots(prizes []LotteryPrize) (version, candidatesJSON, weightsJSON, probabilitiesJSON string, candidates []LotteryPrize, err error) {
	for _, prize := range prizes {
		if prize.Enabled && prize.Weight > 0 && prize.Stock != 0 {
			candidates = append(candidates, prize)
		}
	}
	if len(candidates) == 0 {
		return "", "", "", "", nil, errors.New("lottery prize pool is empty")
	}
	candidateSnapshots := make([]lotteryCandidateSnapshot, 0, len(candidates))
	weightSnapshots := make([]lotteryWeightSnapshot, 0, len(candidates))
	total := 0
	for _, prize := range candidates {
		total += prize.Weight
		candidateSnapshots = append(candidateSnapshots, lotteryCandidateSnapshot{ID: prize.Id, Name: prize.Name, PrizeType: prize.PrizeType, RewardQuota: prize.RewardQuota, Stock: prize.Stock, Weight: prize.Weight})
		weightSnapshots = append(weightSnapshots, lotteryWeightSnapshot{PrizeID: prize.Id, Weight: prize.Weight})
	}
	probabilities := make([]lotteryProbabilitySnapshot, 0, len(candidates))
	for _, prize := range candidates {
		probability := prize.Weight * 10000 / total
		probabilities = append(probabilities, lotteryProbabilitySnapshot{PrizeID: prize.Id, Weight: prize.Weight, ProbabilityBasisPoints: probability})
	}
	var errJSON error
	if candidatesJSONBytes, e := common.Marshal(candidateSnapshots); e != nil {
		errJSON = e
	} else {
		candidatesJSON = string(candidatesJSONBytes)
	}
	if errJSON == nil {
		if weightsJSONBytes, e := common.Marshal(weightSnapshots); e != nil {
			errJSON = e
		} else {
			weightsJSON = string(weightsJSONBytes)
		}
	}
	if errJSON == nil {
		if probabilitiesJSONBytes, e := common.Marshal(probabilities); e != nil {
			errJSON = e
		} else {
			probabilitiesJSON = string(probabilitiesJSONBytes)
		}
	}
	if errJSON != nil {
		return "", "", "", "", nil, errJSON
	}
	// Hash the exact candidate and probability snapshots so configuration
	// changes are visible in audit records without relying on timestamps.
	digest := sha256.Sum256([]byte(candidatesJSON + "|" + probabilitiesJSON))
	version = hex.EncodeToString(digest[:])
	return version, candidatesJSON, weightsJSON, probabilitiesJSON, candidates, nil
}

func lotteryOptionInt(key string, fallback, min, max int) int {
	value := fallback
	common.OptionMapRWMutex.RLock()
	if common.OptionMap != nil {
		if parsed, err := strconv.Atoi(common.OptionMap[key]); err == nil && parsed >= min && parsed <= max {
			value = parsed
		}
	}
	common.OptionMapRWMutex.RUnlock()
	return value
}

func LotteryDailyThreshold() int {
	return lotteryOptionInt(LotteryThresholdKey, common.GetTrustQuota(), 1, 1<<30)
}

func LotteryDailyAttempts() int {
	return lotteryOptionInt(LotteryDailyAttemptsKey, 1, 1, 100)
}

func LotteryKeepAttempts() bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	if common.OptionMap == nil {
		return false
	}
	value, err := strconv.ParseBool(common.OptionMap[LotteryKeepAttemptsKey])
	return err == nil && value
}

func lotteryOptionBool(key string, fallback bool) bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	if common.OptionMap == nil {
		return fallback
	}
	value, err := strconv.ParseBool(common.OptionMap[key])
	if err != nil {
		return fallback
	}
	return value
}

func LotteryInviteRegisterEnabled() bool { return lotteryOptionBool(LotteryInviteRegisterKey, false) }
func LotteryInviteRechargeEnabled() bool { return lotteryOptionBool(LotteryInviteRechargeKey, false) }

func lotteryDayKey() string {
	location, err := time.LoadLocation(common.ChannelUsageTimezone)
	if err != nil {
		location = time.Local
	}
	return time.Now().In(location).Format("2006-01-02")
}

func RecordLotteryConsumption(userId, quota int) error {
	if userId <= 0 || quota <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return RecordLotteryConsumptionTx(tx, userId, quota)
	})
}

func RecordLotteryConsumptionTx(tx *gorm.DB, userId, quota int) error {
	if quota <= 0 {
		return nil
	}
	day := lotteryDayKey()
	daily, err := ensureLotteryDailyTx(tx, userId, day)
	if err != nil {
		return err
	}
	threshold := LotteryDailyThreshold()
	maxAttempts := LotteryDailyAttempts()
	newConsumed := daily.ConsumedQuota + quota
	eligible := newConsumed / threshold
	granted := daily.GrantedAttempts
	if eligible > granted {
		granted = eligible
	}
	if granted > maxAttempts {
		granted = maxAttempts
	}
	return tx.Model(&LotteryDaily{}).Where("id = ?", daily.Id).Updates(map[string]interface{}{"consumed_quota": newConsumed, "granted_attempts": granted, "updated_at": common.GetTimestamp()}).Error
}

// GrantLotteryAttemptTx grants one explicit attempt for the current day. It is
// used by configured invitation events and is idempotent at the event layer.
func GrantLotteryAttemptTx(tx *gorm.DB, userId int, count int) error {
	if userId <= 0 || count <= 0 {
		return nil
	}
	day := lotteryDayKey()
	daily, err := ensureLotteryDailyTx(tx, userId, day)
	if err != nil {
		return err
	}
	maxAttempts := LotteryDailyAttempts()
	granted := daily.GrantedAttempts + count
	if granted > maxAttempts {
		granted = maxAttempts
	}
	return tx.Model(&LotteryDaily{}).Where("id = ?", daily.Id).Updates(map[string]interface{}{"granted_attempts": granted, "updated_at": common.GetTimestamp()}).Error
}

func GrantLotteryAttempt(userId, count int) error {
	return DB.Transaction(func(tx *gorm.DB) error { return GrantLotteryAttemptTx(tx, userId, count) })
}

func ensureLotteryDailyTx(tx *gorm.DB, userId int, day string) (LotteryDaily, error) {
	var daily LotteryDaily
	err := tx.Where("user_id = ? AND day_key = ?", userId, day).First(&daily).Error
	if err == nil {
		return daily, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return daily, err
	}
	carry := 0
	if LotteryKeepAttempts() {
		var previous LotteryDaily
		if previousErr := tx.Where("user_id = ? AND day_key < ?", userId, day).Order("day_key desc").First(&previous).Error; previousErr == nil {
			carry = previous.GrantedAttempts - previous.UsedAttempts
			if carry < 0 {
				carry = 0
			}
		}
	}
	daily = LotteryDaily{UserId: userId, DayKey: day, GrantedAttempts: carry, CreatedAt: common.GetTimestamp(), UpdatedAt: common.GetTimestamp()}
	result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "day_key"}}, DoNothing: true}).Create(&daily)
	if result.Error != nil {
		return daily, result.Error
	}
	if result.RowsAffected == 0 {
		if err = tx.Where("user_id = ? AND day_key = ?", userId, day).First(&daily).Error; err != nil {
			return daily, err
		}
	}
	return daily, nil
}

func GetLotteryStatus(userId int) (LotteryDaily, error) {
	day := lotteryDayKey()
	return ensureLotteryDailyTx(DB, userId, day)
}

func selectLotteryPrize(prizes []LotteryPrize) (*LotteryPrize, error) {
	total := 0
	for _, prize := range prizes {
		if prize.Enabled && prize.Weight > 0 && (prize.Stock != 0) {
			total += prize.Weight
		}
	}
	if total <= 0 {
		return nil, errors.New("lottery prize pool is empty")
	}
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, err
	}
	value := int((uint64(random[0])<<56 | uint64(random[1])<<48 | uint64(random[2])<<40 | uint64(random[3])<<32 | uint64(random[4])<<24 | uint64(random[5])<<16 | uint64(random[6])<<8 | uint64(random[7])) % uint64(total))
	for index := range prizes {
		prize := &prizes[index]
		if !prize.Enabled || prize.Weight <= 0 || prize.Stock == 0 {
			continue
		}
		if value < prize.Weight {
			return prize, nil
		}
		value -= prize.Weight
	}
	return nil, errors.New("lottery prize selection failed")
}

func DrawLottery(userId int, idempotencyKey string) (*LotteryDraw, error) {
	if userId <= 0 || idempotencyKey == "" {
		return nil, errors.New("invalid lottery request")
	}
	var draw LotteryDraw
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("idempotency_key = ?", idempotencyKey).First(&draw).Error; err == nil {
			if draw.UserId != userId {
				return errors.New("lottery idempotency key belongs to another user")
			}
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		day := lotteryDayKey()
		daily, err := ensureLotteryDailyTx(tx, userId, day)
		if err != nil {
			return errors.New("lottery attempt is not available")
		}
		if err = tx.Set("gorm:query_option", "FOR UPDATE").Where("id = ?", daily.Id).First(&daily).Error; err != nil {
			return errors.New("lottery attempt is not available")
		}
		if daily.UsedAttempts >= daily.GrantedAttempts {
			return errors.New("lottery attempt is not available")
		}
		var prizes []LotteryPrize
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("enabled = ?", true).Order("id asc").Find(&prizes).Error; err != nil {
			return err
		}
		poolVersion, candidateJSON, weightJSON, probabilityJSON, candidates, err := buildLotterySnapshots(prizes)
		if err != nil {
			return err
		}
		prize, err := selectLotteryPrize(candidates)
		if err != nil {
			return err
		}
		if prize.Stock > 0 {
			result := tx.Model(&LotteryPrize{}).Where("id = ? AND stock > 0", prize.Id).Update("stock", gorm.Expr("stock - ?", 1))
			if result.Error != nil || result.RowsAffected != 1 {
				return errors.New("lottery prize is sold out")
			}
		}
		if err = tx.Model(&LotteryDaily{}).Where("id = ? AND used_attempts < granted_attempts", daily.Id).Update("used_attempts", gorm.Expr("used_attempts + ?", 1)).Error; err != nil {
			return err
		}
		totalWeight := 0
		for _, candidate := range candidates {
			totalWeight += candidate.Weight
		}
		resultProbability := 0
		if totalWeight > 0 {
			resultProbability = prize.Weight * 10000 / totalWeight
		}
		draw = LotteryDraw{UserId: userId, DayKey: day, PrizeId: prize.Id, PrizeName: prize.Name, RewardQuota: prize.RewardQuota, PoolVersion: poolVersion, CandidateSnapshot: candidateJSON, WeightSnapshot: weightJSON, ProbabilitySnapshot: probabilityJSON, ResultProbability: resultProbability, IdempotencyKey: idempotencyKey, CreatedAt: common.GetTimestamp()}
		if err = tx.Create(&draw).Error; err != nil {
			return err
		}
		if prize.PrizeType == LotteryPrizeGift && prize.RewardQuota > 0 {
			key := fmt.Sprintf("lottery:%d", draw.Id)
			if err = CreditGiftTx(tx, userId, prize.RewardQuota, draw.Id, "lottery", idempotencyKey, WalletBusinessLotteryReward, key, 0, prize.Name); err != nil {
				return err
			}
		}
		return nil
	})
	return &draw, err
}

func UpsertLotteryPrize(prize *LotteryPrize) error {
	if prize == nil || prize.Name == "" || prize.Weight < 0 || prize.Stock < -1 || (prize.PrizeType != LotteryPrizeGift && prize.PrizeType != LotteryPrizeNone) {
		return errors.New("invalid lottery prize")
	}
	now := common.GetTimestamp()
	if prize.CreatedAt == 0 {
		prize.CreatedAt = now
	}
	prize.UpdatedAt = now
	if prize.Id == 0 {
		return DB.Create(prize).Error
	}
	return DB.Model(&LotteryPrize{}).Where("id = ?", prize.Id).Updates(map[string]interface{}{"name": prize.Name, "prize_type": prize.PrizeType, "reward_quota": prize.RewardQuota, "weight": prize.Weight, "stock": prize.Stock, "enabled": prize.Enabled, "updated_at": now}).Error
}

func ListLotteryPrizes() ([]LotteryPrize, error) {
	var prizes []LotteryPrize
	return prizes, DB.Order("id asc").Find(&prizes).Error
}

func ListLotteryDraws(userId, limit, offset int) ([]LotteryDraw, int64, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := DB.Model(&LotteryDraw{}).Where("user_id = ?", userId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var draws []LotteryDraw
	if err := query.Order("id desc").Limit(limit).Offset(offset).Find(&draws).Error; err != nil {
		return nil, 0, err
	}
	return draws, total, nil
}

func DeleteLotteryPrize(id int) error {
	if id <= 0 {
		return errors.New("invalid lottery prize id")
	}
	return DB.Delete(&LotteryPrize{}, id).Error
}
