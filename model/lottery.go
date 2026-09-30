package model

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	LotteryEnabledKey                = "LotteryEnabled"
	LotteryThresholdKey              = "LotteryDailyConsumeThreshold"
	LotteryDailyAttemptsKey          = "LotteryDailyAttempts"
	LotteryKeepAttemptsKey           = "LotteryKeepAttempts"
	LotteryInviteRegisterKey         = "LotteryInviteRegisterEnabled"
	LotteryInviteRechargeKey         = "LotteryInviteRechargeEnabled"
	LotteryInviteRegisterAttemptsKey = "LotteryInviteRegisterAttempts"
	LotteryInviteRechargeAttemptsKey = "LotteryInviteRechargeAttempts"
	LotteryPrizeGift                 = "gift"
	LotteryPrizeNone                 = "none"
)

type LotteryPrize struct {
	Id          int    `json:"id"`
	Name        string `json:"name" gorm:"type:varchar(128);not null"`
	PrizeType   string `json:"prize_type" gorm:"type:varchar(32);not null"`
	RewardQuota int    `json:"reward_quota"`
	Weight      int    `json:"weight"`
	// ConfiguredProbabilityBasisPoints stores an optional direct probability
	// value. A zero value keeps legacy weight-based behavior.
	ConfiguredProbabilityBasisPoints int   `json:"configured_probability_basis_points" gorm:"not null;default:0"`
	Stock                            int   `json:"stock"` // -1 means unlimited
	Enabled                          bool  `json:"enabled" gorm:"index"`
	CreatedAt                        int64 `json:"created_at"`
	UpdatedAt                        int64 `json:"updated_at"`
	// The following fields are computed for API responses and are never stored.
	TotalWeight                           int  `json:"total_weight,omitempty" gorm:"-"`
	Eligible                              bool `json:"eligible" gorm:"-"`
	ProbabilityBasisPoints                int  `json:"probability_basis_points" gorm:"-"`
	ConfiguredProbabilityTotalBasisPoints int  `json:"configured_probability_total_basis_points,omitempty" gorm:"-"`
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
	PrizeID                          int `json:"prize_id"`
	Weight                           int `json:"weight"`
	ConfiguredProbabilityBasisPoints int `json:"configured_probability_basis_points,omitempty"`
	ProbabilityBasisPoints           int `json:"probability_basis_points"`
}

type lotteryWeightSnapshot struct {
	PrizeID int `json:"prize_id"`
	Weight  int `json:"weight"`
}

// LotteryPrizeStat is the operational view of a prize pool. Configured
// probability is derived from the recorded probability snapshot for the
// selected reporting window, so later pool edits do not rewrite history.
type LotteryPrizeStat struct {
	ID                               int    `json:"id"`
	Name                             string `json:"name"`
	PrizeType                        string `json:"prize_type"`
	RewardQuota                      int    `json:"reward_quota"`
	Weight                           int    `json:"weight"`
	Stock                            int    `json:"stock"`
	Enabled                          bool   `json:"enabled"`
	Configured                       bool   `json:"configured"`
	Eligible                         bool   `json:"eligible"`
	ConfiguredProbabilityBasisPoints int    `json:"configured_probability_basis_points"`
	DrawCount                        int64  `json:"draw_count"`
	ActualProbabilityBasisPoints     int    `json:"actual_probability_basis_points"`
}

type LotteryStats struct {
	StartTimestamp int64              `json:"start_timestamp,omitempty"`
	EndTimestamp   int64              `json:"end_timestamp,omitempty"`
	TotalDraws     int64              `json:"total_draws"`
	Participants   int64              `json:"participants"`
	RewardQuota    int64              `json:"reward_quota"`
	PoolWeight     int                `json:"pool_weight"`
	Prizes         []LotteryPrizeStat `json:"prizes"`
}

func GetLotteryStats(startTimestamp, endTimestamp int64) (*LotteryStats, error) {
	if startTimestamp < 0 || endTimestamp < 0 || (startTimestamp > 0 && endTimestamp > 0 && endTimestamp < startTimestamp) {
		return nil, errors.New("invalid lottery stats time range")
	}
	prizes, err := ListLotteryPrizeViews()
	if err != nil {
		return nil, err
	}
	stats := &LotteryStats{StartTimestamp: startTimestamp, EndTimestamp: endTimestamp, Prizes: make([]LotteryPrizeStat, 0, len(prizes))}
	prizeIndexes := make(map[int]int, len(prizes))
	if len(prizes) > 0 {
		stats.PoolWeight = prizes[0].TotalWeight
	}
	for _, prize := range prizes {
		prizeIndexes[prize.Id] = len(stats.Prizes)
		stats.Prizes = append(stats.Prizes, LotteryPrizeStat{
			ID: prize.Id, Name: prize.Name, PrizeType: prize.PrizeType,
			RewardQuota: prize.RewardQuota, Weight: prize.Weight, Stock: prize.Stock,
			Enabled: prize.Enabled, Configured: true, Eligible: prize.Eligible,
			// Keep this field limited to an explicitly configured probability.
			// Weight-based prizes are represented by zero and explained by the UI.
			ConfiguredProbabilityBasisPoints: prize.ConfiguredProbabilityBasisPoints,
		})
	}

	drawQuery := func() *gorm.DB {
		query := DB.Model(&LotteryDraw{})
		if startTimestamp > 0 {
			query = query.Where("created_at >= ?", startTimestamp)
		}
		if endTimestamp > 0 {
			query = query.Where("created_at <= ?", endTimestamp)
		}
		return query
	}

	query := drawQuery()
	if err = query.Count(&stats.TotalDraws).Error; err != nil {
		return nil, err
	}
	if err = drawQuery().Distinct("user_id").Count(&stats.Participants).Error; err != nil {
		return nil, err
	}
	type prizeCount struct {
		PrizeID     int    `gorm:"column:prize_id"`
		PrizeName   string `gorm:"column:prize_name"`
		DrawCount   int64  `gorm:"column:draw_count"`
		RewardQuota int64  `gorm:"column:reward_quota"`
	}
	var counts []prizeCount
	// Group by the stored name as well. PostgreSQL does not provide max(text),
	// while grouping plain columns is portable across SQLite, MySQL, and PostgreSQL.
	if err = drawQuery().Select("prize_id, prize_name, count(*) as draw_count, coalesce(sum(reward_quota), 0) as reward_quota").Group("prize_id, prize_name").Find(&counts).Error; err != nil {
		return nil, err
	}
	byPrize := make(map[int]prizeCount, len(counts))
	for _, count := range counts {
		aggregate := byPrize[count.PrizeID]
		if aggregate.PrizeName == "" {
			aggregate.PrizeID = count.PrizeID
			aggregate.PrizeName = count.PrizeName
		}
		aggregate.DrawCount += count.DrawCount
		aggregate.RewardQuota += count.RewardQuota
		byPrize[count.PrizeID] = aggregate
		stats.RewardQuota += count.RewardQuota
	}
	// A draw stores the exact pool probability used at draw time. Average those
	// snapshots per prize for the reporting window instead of recalculating the
	// current pool, which may have changed since the draw was made.
	type drawSnapshot struct {
		PrizeID             int
		ProbabilitySnapshot string
	}
	var snapshots []drawSnapshot
	if err = drawQuery().Select("prize_id, probability_snapshot").Find(&snapshots).Error; err != nil {
		return nil, err
	}
	configuredSums := make(map[int]int64)
	configuredCounts := make(map[int]int64)
	for _, draw := range snapshots {
		if draw.ProbabilitySnapshot == "" {
			continue
		}
		var probabilities []lotteryProbabilitySnapshot
		if err = common.Unmarshal([]byte(draw.ProbabilitySnapshot), &probabilities); err != nil {
			continue
		}
		for _, probability := range probabilities {
			// A zero value means that the prize used the legacy weight fallback.
			// Do not present its effective probability as a direct configuration.
			if probability.ConfiguredProbabilityBasisPoints > 0 {
				configuredSums[probability.PrizeID] += int64(probability.ConfiguredProbabilityBasisPoints)
				configuredCounts[probability.PrizeID]++
			}
		}
	}
	for prizeID, count := range byPrize {
		index, ok := prizeIndexes[prizeID]
		if !ok {
			// Keep historical draws visible even when an admin deletes a prize.
			index = len(stats.Prizes)
			prizeIndexes[prizeID] = index
			stats.Prizes = append(stats.Prizes, LotteryPrizeStat{
				ID: prizeID, Name: count.PrizeName, PrizeType: "historical",
				Enabled: false, Configured: false, Eligible: false,
			})
		}
		stats.Prizes[index].DrawCount = count.DrawCount
		if configuredCounts[prizeID] > 0 {
			stats.Prizes[index].ConfiguredProbabilityBasisPoints = int(configuredSums[prizeID] / configuredCounts[prizeID])
		}
		if stats.TotalDraws > 0 {
			stats.Prizes[index].ActualProbabilityBasisPoints = int(count.DrawCount * 10000 / stats.TotalDraws)
		}
	}
	return stats, nil
}

func buildLotterySnapshots(prizes []LotteryPrize) (version, candidatesJSON, weightsJSON, probabilitiesJSON string, candidates []LotteryPrize, err error) {
	for _, prize := range prizes {
		if isLotteryCandidate(prize) {
			candidates = append(candidates, prize)
		}
	}
	if len(candidates) == 0 {
		return "", "", "", "", nil, errors.New("lottery prize pool is empty")
	}
	candidateSnapshots := make([]lotteryCandidateSnapshot, 0, len(candidates))
	weightSnapshots := make([]lotteryWeightSnapshot, 0, len(candidates))
	for _, prize := range candidates {
		candidateSnapshots = append(candidateSnapshots, lotteryCandidateSnapshot{ID: prize.Id, Name: prize.Name, PrizeType: prize.PrizeType, RewardQuota: prize.RewardQuota, Stock: prize.Stock, Weight: prize.Weight})
		weightSnapshots = append(weightSnapshots, lotteryWeightSnapshot{PrizeID: prize.Id, Weight: prize.Weight})
	}
	_, probabilityByPrize := calculateLotteryProbabilities(candidates)
	probabilities := make([]lotteryProbabilitySnapshot, 0, len(candidates))
	for _, prize := range candidates {
		probabilities = append(probabilities, lotteryProbabilitySnapshot{PrizeID: prize.Id, Weight: prize.Weight, ConfiguredProbabilityBasisPoints: prize.ConfiguredProbabilityBasisPoints, ProbabilityBasisPoints: probabilityByPrize[prize.Id]})
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

func LotteryEnabled() bool { return lotteryOptionBool(LotteryEnabledKey, true) }

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

func LotteryInviteRegisterAttempts() int {
	return lotteryOptionInt(LotteryInviteRegisterAttemptsKey, 1, 0, 100)
}

func LotteryInviteRechargeAttempts() int {
	return lotteryOptionInt(LotteryInviteRechargeAttemptsKey, 1, 0, 100)
}

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
	if quota <= 0 || !LotteryEnabled() {
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

// GrantLotteryAttemptTx grants explicit attempts for the current day. The
// LotteryDailyAttempts limit applies only to consumption-earned attempts;
// configured invitation rewards are additive and are idempotent at the event
// layer.
func GrantLotteryAttemptTx(tx *gorm.DB, userId int, count int) error {
	if userId <= 0 || count <= 0 || !LotteryEnabled() {
		return nil
	}
	day := lotteryDayKey()
	daily, err := ensureLotteryDailyTx(tx, userId, day)
	if err != nil {
		return err
	}
	// Invitation and recharge rewards are additive events. Increment in the
	// database so concurrent reward settlements cannot overwrite each other.
	return tx.Model(&LotteryDaily{}).
		Where("id = ?", daily.Id).
		Updates(map[string]interface{}{
			"granted_attempts": gorm.Expr("granted_attempts + ?", count),
			"updated_at":       common.GetTimestamp(),
		}).Error
}

// grantInviteRechargeLotteryTx keeps invitation lottery rewards independent
// from cash and promotion settlement. A lottery storage error is logged but
// does not roll back the recharge or its promotion rewards.
func grantInviteRechargeLotteryTx(tx *gorm.DB, payerUserId int) {
	if !LotteryInviteRechargeEnabled() {
		return
	}
	var invited User
	if err := tx.Select("inviter_id").First(&invited, payerUserId).Error; err != nil || invited.InviterId <= 0 {
		return
	}
	if err := GrantLotteryAttemptTx(tx, invited.InviterId, LotteryInviteRechargeAttempts()); err != nil {
		common.SysError("failed to grant invitation recharge lottery attempts: " + err.Error())
	}
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
	_, probabilities := calculateLotteryProbabilities(prizes)
	total := 0
	for _, probability := range probabilities {
		total += probability
	}
	if total <= 0 {
		return nil, errors.New("lottery prize pool is empty")
	}
	// crypto/rand.Int uses rejection sampling, so every weight bucket has the
	// exact configured probability even when total is not a power of two.
	valueBig, err := rand.Int(rand.Reader, big.NewInt(int64(total)))
	if err != nil {
		return nil, err
	}
	value := int(valueBig.Int64())
	for index := range prizes {
		prize := &prizes[index]
		if !isLotteryCandidate(*prize) {
			continue
		}
		probability := probabilities[prize.Id]
		if value < probability {
			return prize, nil
		}
		value -= probability
	}
	return nil, errors.New("lottery prize selection failed")
}

func DrawLottery(userId int, idempotencyKey string) (*LotteryDraw, error) {
	if userId <= 0 || idempotencyKey == "" {
		return nil, errors.New("invalid lottery request")
	}
	if !LotteryEnabled() {
		return nil, errors.New("lottery is disabled")
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
		attemptResult := tx.Model(&LotteryDaily{}).Where("id = ? AND used_attempts < granted_attempts", daily.Id).Update("used_attempts", gorm.Expr("used_attempts + ?", 1))
		if attemptResult.Error != nil {
			return attemptResult.Error
		}
		if attemptResult.RowsAffected != 1 {
			return errors.New("lottery attempt is not available")
		}
		_, probabilityByPrize := calculateLotteryProbabilities(candidates)
		resultProbability := probabilityByPrize[prize.Id]
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
	if prize == nil {
		return errors.New("invalid lottery prize")
	}
	configuredProbability := prize.ConfiguredProbabilityBasisPoints
	// Accept the response-facing field for backwards-compatible admin clients.
	if configuredProbability == 0 && prize.ProbabilityBasisPoints > 0 {
		configuredProbability = prize.ProbabilityBasisPoints
	}
	if prize.Name == "" || prize.Weight < 0 || prize.Stock < -1 || configuredProbability < 0 || configuredProbability > 10000 || (prize.PrizeType != LotteryPrizeGift && prize.PrizeType != LotteryPrizeNone) {
		return errors.New("invalid lottery prize")
	}
	prize.ConfiguredProbabilityBasisPoints = configuredProbability
	now := common.GetTimestamp()
	if prize.CreatedAt == 0 {
		prize.CreatedAt = now
	}
	prize.UpdatedAt = now
	if prize.Id == 0 {
		return DB.Create(prize).Error
	}
	return DB.Model(&LotteryPrize{}).Where("id = ?", prize.Id).Updates(map[string]interface{}{"name": prize.Name, "prize_type": prize.PrizeType, "reward_quota": prize.RewardQuota, "weight": prize.Weight, "configured_probability_basis_points": configuredProbability, "stock": prize.Stock, "enabled": prize.Enabled, "updated_at": now}).Error
}

func ListLotteryPrizes() ([]LotteryPrize, error) {
	var prizes []LotteryPrize
	return prizes, DB.Order("id asc").Find(&prizes).Error
}

func calculateLotteryProbabilities(prizes []LotteryPrize) (int, map[int]int) {
	totalWeight := 0
	configuredTotal := 0
	legacyWeight := 0
	eligibleIndexes := make([]int, 0, len(prizes))
	for index, prize := range prizes {
		if isLotteryCandidate(prize) {
			totalWeight += prize.Weight
			configuredTotal += prize.ConfiguredProbabilityBasisPoints
			if prize.ConfiguredProbabilityBasisPoints == 0 {
				legacyWeight += prize.Weight
			}
			eligibleIndexes = append(eligibleIndexes, index)
		}
	}
	probabilities := make(map[int]int, len(eligibleIndexes))
	if totalWeight <= 0 && configuredTotal <= 0 {
		return 0, probabilities
	}
	allocated := 0
	if configuredTotal > 0 {
		// Direct probabilities are stored in basis points. If only part of the
		// pool is configured, the remaining share is distributed to legacy
		// weight-based prizes. If every prize is configured but the values do
		// not sum to 100%, normalize them as a relative distribution.
		for _, index := range eligibleIndexes {
			prize := prizes[index]
			if prize.ConfiguredProbabilityBasisPoints > 0 {
				probability := prize.ConfiguredProbabilityBasisPoints
				if legacyWeight == 0 {
					probability = probability * 10000 / configuredTotal
				}
				probabilities[prize.Id] = probability
				allocated += probability
			}
		}
		if legacyWeight > 0 && configuredTotal < 10000 {
			remaining := 10000 - configuredTotal
			for _, index := range eligibleIndexes {
				prize := prizes[index]
				if prize.ConfiguredProbabilityBasisPoints == 0 {
					probability := prize.Weight * remaining / legacyWeight
					probabilities[prize.Id] = probability
					allocated += probability
				}
			}
		} else if legacyWeight > 0 && configuredTotal > 10000 {
			// Over-specified pools still need a valid draw distribution. Treat
			// configured values as relative weights when they exceed 100%.
			allocated = 0
			for _, index := range eligibleIndexes {
				prize := prizes[index]
				if prize.ConfiguredProbabilityBasisPoints > 0 {
					probability := prize.ConfiguredProbabilityBasisPoints * 10000 / configuredTotal
					probabilities[prize.Id] = probability
					allocated += probability
				} else {
					probabilities[prize.Id] = 0
				}
			}
		}
	} else {
		for _, index := range eligibleIndexes {
			prize := prizes[index]
			probabilities[prize.Id] = prizes[index].Weight * 10000 / totalWeight
			allocated += probabilities[prize.Id]
		}
	}
	// Integer basis points can leave a small remainder. Spread it one point at
	// a time so the displayed pool totals 100% without distorting one prize.
	for offset := 0; allocated < 10000; offset++ {
		prize := prizes[eligibleIndexes[offset%len(eligibleIndexes)]]
		probabilities[prize.Id]++
		allocated++
	}
	return totalWeight, probabilities
}

func isLotteryCandidate(prize LotteryPrize) bool {
	return prize.Enabled && prize.Stock != 0 && (prize.Weight > 0 || prize.ConfiguredProbabilityBasisPoints > 0)
}

// ListLotteryPrizeViews decorates prize configuration with the probability
// currently used by the draw pool. Eligibility follows the draw path exactly:
// disabled, zero-weight, and sold-out prizes are excluded from the denominator.
func ListLotteryPrizeViews() ([]LotteryPrize, error) {
	prizes, err := ListLotteryPrizes()
	if err != nil {
		return nil, err
	}
	totalWeight, probabilityByPrize := calculateLotteryProbabilities(prizes)
	configuredTotal := 0
	for _, candidate := range prizes {
		if isLotteryCandidate(candidate) {
			configuredTotal += candidate.ConfiguredProbabilityBasisPoints
		}
	}
	for index := range prizes {
		prize := &prizes[index]
		prize.TotalWeight = totalWeight
		prize.ConfiguredProbabilityTotalBasisPoints = configuredTotal
		prize.Eligible = isLotteryCandidate(*prize)
		if prize.Eligible {
			prize.ProbabilityBasisPoints = probabilityByPrize[prize.Id]
		}
	}
	return prizes, nil
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
