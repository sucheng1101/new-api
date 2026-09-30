package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupLotteryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(
		&User{},
		&LotteryPrize{},
		&LotteryDaily{},
		&LotteryDraw{},
		&WalletOperation{},
		&WalletTransaction{},
		&WalletCashLot{},
		&WalletConsumptionAllocation{},
	))
	previousDB := DB
	DB = db
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{
		LotteryThresholdKey:     "100",
		LotteryDailyAttemptsKey: "1",
		LotteryKeepAttemptsKey:  "false",
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	return db
}

func createLotteryTestUser(t *testing.T, db *gorm.DB, username string) User {
	t.Helper()
	user := User{Username: username, Password: "lottery-test-password", Status: common.UserStatusEnabled, AffCode: username + "-aff"}
	require.NoError(t, db.Create(&user).Error)
	return user
}

func TestLotteryConsumptionDrawRewardAndIdempotency(t *testing.T) {
	db := setupLotteryTestDB(t)
	user := createLotteryTestUser(t, db, "lottery-happy-path")
	prize := &LotteryPrize{Name: "gift reward", PrizeType: LotteryPrizeGift, RewardQuota: 50, Weight: 1, Stock: 1, Enabled: true}
	require.NoError(t, UpsertLotteryPrize(prize))

	require.NoError(t, RecordLotteryConsumption(user.Id, 99))
	status, err := GetLotteryStatus(user.Id)
	require.NoError(t, err)
	require.Equal(t, 99, status.ConsumedQuota)
	require.Zero(t, status.GrantedAttempts)
	require.Error(t, func() error {
		_, drawErr := DrawLottery(user.Id, "lottery-before-threshold")
		return drawErr
	}())

	require.NoError(t, RecordLotteryConsumption(user.Id, 1))
	status, err = GetLotteryStatus(user.Id)
	require.NoError(t, err)
	require.Equal(t, 1, status.GrantedAttempts)

	draw, err := DrawLottery(user.Id, "lottery-draw-once")
	require.NoError(t, err)
	require.Equal(t, prize.Id, draw.PrizeId)
	require.Equal(t, 50, draw.RewardQuota)
	require.NotEmpty(t, draw.PoolVersion)
	require.NotEmpty(t, draw.CandidateSnapshot)
	require.NotEmpty(t, draw.ProbabilitySnapshot)

	var refreshed User
	require.NoError(t, db.First(&refreshed, user.Id).Error)
	require.Equal(t, 50, refreshed.GiftQuota)
	require.Equal(t, 50, refreshed.Quota)
	status, err = GetLotteryStatus(user.Id)
	require.NoError(t, err)
	require.Equal(t, 1, status.UsedAttempts)

	retried, err := DrawLottery(user.Id, "lottery-draw-once")
	require.NoError(t, err)
	require.Equal(t, draw.Id, retried.Id)
	require.Equal(t, draw.PrizeId, retried.PrizeId)
	var giftTransactions int64
	require.NoError(t, db.Model(&WalletTransaction{}).Where("business_type = ?", WalletBusinessLotteryReward).Count(&giftTransactions).Error)
	require.EqualValues(t, 1, giftTransactions)

	_, err = DrawLottery(user.Id, "lottery-draw-second")
	require.Error(t, err)
	require.EqualError(t, err, "lottery attempt is not available")
}

func TestLotteryDrawRejectsEmptyAndExhaustedPrizePoolsWithoutConsumingAttempt(t *testing.T) {
	db := setupLotteryTestDB(t)
	user := createLotteryTestUser(t, db, "lottery-empty-pool")
	require.NoError(t, GrantLotteryAttempt(user.Id, 1))

	_, err := DrawLottery(user.Id, "lottery-empty-pool-draw")
	require.EqualError(t, err, "lottery prize pool is empty")
	status, statusErr := GetLotteryStatus(user.Id)
	require.NoError(t, statusErr)
	require.Zero(t, status.UsedAttempts)

	prize := &LotteryPrize{Name: "limited gift", PrizeType: LotteryPrizeGift, RewardQuota: 25, Weight: 1, Stock: 1, Enabled: true}
	require.NoError(t, UpsertLotteryPrize(prize))
	draw, err := DrawLottery(user.Id, "lottery-stock-once")
	require.NoError(t, err)
	require.Equal(t, prize.Id, draw.PrizeId)

	secondUser := createLotteryTestUser(t, db, "lottery-stock-exhausted")
	require.NoError(t, GrantLotteryAttempt(secondUser.Id, 1))
	_, err = DrawLottery(secondUser.Id, "lottery-stock-empty")
	require.EqualError(t, err, "lottery prize pool is empty")
	secondStatus, statusErr := GetLotteryStatus(secondUser.Id)
	require.NoError(t, statusErr)
	require.Zero(t, secondStatus.UsedAttempts)
}

func TestLotteryGrantAndPrizeValidation(t *testing.T) {
	db := setupLotteryTestDB(t)
	user := createLotteryTestUser(t, db, "lottery-grants")
	common.OptionMapRWMutex.Lock()
	common.OptionMap[LotteryDailyAttemptsKey] = "2"
	common.OptionMapRWMutex.Unlock()
	require.NoError(t, GrantLotteryAttempt(user.Id, 10))
	status, err := GetLotteryStatus(user.Id)
	require.NoError(t, err)
	require.Equal(t, 10, status.GrantedAttempts)

	require.Error(t, UpsertLotteryPrize(&LotteryPrize{Name: "invalid", PrizeType: "cash", Weight: 1, Stock: 1, Enabled: true}))
	require.Error(t, UpsertLotteryPrize(&LotteryPrize{Name: "invalid stock", PrizeType: LotteryPrizeNone, Weight: 1, Stock: -2, Enabled: true}))
	require.NoError(t, UpsertLotteryPrize(&LotteryPrize{Name: "no prize", PrizeType: LotteryPrizeNone, Weight: 1, Stock: -1, Enabled: true}))
	prizes, err := ListLotteryPrizes()
	require.NoError(t, err)
	require.Len(t, prizes, 1)
}

func TestListLotteryPrizeViewsCalculatesOnlyEligiblePool(t *testing.T) {
	setupLotteryTestDB(t)
	eligibleA := &LotteryPrize{Name: "eligible-a", PrizeType: LotteryPrizeGift, RewardQuota: 20, Weight: 3, Stock: -1, Enabled: true}
	eligibleB := &LotteryPrize{Name: "eligible-b", PrizeType: LotteryPrizeNone, Weight: 1, Stock: 2, Enabled: true}
	disabled := &LotteryPrize{Name: "disabled", PrizeType: LotteryPrizeNone, Weight: 100, Stock: -1, Enabled: false}
	soldOut := &LotteryPrize{Name: "sold-out", PrizeType: LotteryPrizeGift, RewardQuota: 10, Weight: 100, Stock: 0, Enabled: true}
	zeroWeight := &LotteryPrize{Name: "zero-weight", PrizeType: LotteryPrizeNone, Weight: 0, Stock: -1, Enabled: true}
	for _, prize := range []*LotteryPrize{eligibleA, eligibleB, disabled, soldOut, zeroWeight} {
		require.NoError(t, UpsertLotteryPrize(prize))
	}

	views, err := ListLotteryPrizeViews()
	require.NoError(t, err)
	require.Len(t, views, 5)
	byID := make(map[int]LotteryPrize, len(views))
	for _, prize := range views {
		byID[prize.Id] = prize
	}
	require.Equal(t, 4, byID[eligibleA.Id].TotalWeight)
	require.True(t, byID[eligibleA.Id].Eligible)
	require.Equal(t, 7500, byID[eligibleA.Id].ProbabilityBasisPoints)
	require.True(t, byID[eligibleB.Id].Eligible)
	require.Equal(t, 2500, byID[eligibleB.Id].ProbabilityBasisPoints)
	for _, id := range []int{disabled.Id, soldOut.Id, zeroWeight.Id} {
		require.False(t, byID[id].Eligible)
		require.Zero(t, byID[id].ProbabilityBasisPoints)
	}
}

func TestCalculateLotteryProbabilitiesDistributesBasisPointRemainder(t *testing.T) {
	totalWeight, probabilities := calculateLotteryProbabilities([]LotteryPrize{
		{Id: 1, Weight: 1, Stock: -1, Enabled: true},
		{Id: 2, Weight: 1, Stock: -1, Enabled: true},
		{Id: 3, Weight: 1, Stock: -1, Enabled: true},
	})
	require.Equal(t, 3, totalWeight)
	require.Equal(t, 10000, probabilities[1]+probabilities[2]+probabilities[3])
	for _, probability := range probabilities {
		require.GreaterOrEqual(t, probability, 3333)
		require.LessOrEqual(t, probability, 3334)
	}
}

func TestCalculateLotteryProbabilitiesSupportsDirectAndLegacyConfiguration(t *testing.T) {
	totalWeight, probabilities := calculateLotteryProbabilities([]LotteryPrize{
		{Id: 1, Weight: 1, ConfiguredProbabilityBasisPoints: 2500, Stock: -1, Enabled: true},
		{Id: 2, Weight: 3, Stock: -1, Enabled: true},
	})
	require.Equal(t, 4, totalWeight)
	require.Equal(t, 2500, probabilities[1])
	require.Equal(t, 7500, probabilities[2])

	_, probabilities = calculateLotteryProbabilities([]LotteryPrize{
		{Id: 1, Weight: 1, ConfiguredProbabilityBasisPoints: 1, Stock: -1, Enabled: true},
		{Id: 2, Weight: 1, ConfiguredProbabilityBasisPoints: 3, Stock: -1, Enabled: true},
	})
	require.Equal(t, 2500, probabilities[1])
	require.Equal(t, 7500, probabilities[2])
}

func TestCalculateLotteryProbabilitiesHandlesProbabilityBoundaries(t *testing.T) {
	_, probabilities := calculateLotteryProbabilities([]LotteryPrize{
		{Id: 1, Weight: 0, ConfiguredProbabilityBasisPoints: 10000, Stock: -1, Enabled: true},
		{Id: 2, Weight: 10, Stock: -1, Enabled: true},
	})
	require.Equal(t, 10000, probabilities[1])
	require.Zero(t, probabilities[2])

	_, probabilities = calculateLotteryProbabilities([]LotteryPrize{
		{Id: 1, Weight: 0, ConfiguredProbabilityBasisPoints: 6000, Stock: -1, Enabled: true},
		{Id: 2, Weight: 0, ConfiguredProbabilityBasisPoints: 6000, Stock: -1, Enabled: true},
		{Id: 3, Weight: 20, Stock: -1, Enabled: true},
	})
	require.Equal(t, 5000, probabilities[1])
	require.Equal(t, 5000, probabilities[2])
	require.Zero(t, probabilities[3])

	_, probabilities = calculateLotteryProbabilities([]LotteryPrize{
		{Id: 1, Weight: 5, ConfiguredProbabilityBasisPoints: 0, Stock: -1, Enabled: true},
		{Id: 2, Weight: 0, ConfiguredProbabilityBasisPoints: 0, Stock: -1, Enabled: true},
		{Id: 3, Weight: 100, Stock: -1, Enabled: false},
		{Id: 4, Weight: 100, Stock: 0, Enabled: true},
	})
	require.Equal(t, 10000, probabilities[1])
	require.Zero(t, probabilities[2])
	require.Zero(t, probabilities[3])
	require.Zero(t, probabilities[4])
}

func TestGetLotteryStatsCalculatesConfiguredAndActualProbabilities(t *testing.T) {
	db := setupLotteryTestDB(t)
	first := createLotteryTestUser(t, db, "lottery-stats-first")
	second := createLotteryTestUser(t, db, "lottery-stats-second")
	firstPrize := &LotteryPrize{Name: "stats gift", PrizeType: LotteryPrizeGift, RewardQuota: 25, Weight: 3, Stock: -1, Enabled: true}
	secondPrize := &LotteryPrize{Name: "stats none", PrizeType: LotteryPrizeNone, Weight: 1, Stock: -1, Enabled: true}
	require.NoError(t, UpsertLotteryPrize(firstPrize))
	require.NoError(t, UpsertLotteryPrize(secondPrize))

	const inRange int64 = 1_700_000_100
	const outOfRange int64 = 1_700_000_000
	firstSnapshot, err := common.Marshal([]lotteryProbabilitySnapshot{{PrizeID: firstPrize.Id, Weight: 3, ConfiguredProbabilityBasisPoints: 2500, ProbabilityBasisPoints: 7500}, {PrizeID: secondPrize.Id, Weight: 1, ProbabilityBasisPoints: 2500}})
	require.NoError(t, err)
	secondSnapshot, err := common.Marshal([]lotteryProbabilitySnapshot{{PrizeID: firstPrize.Id, Weight: 1, ConfiguredProbabilityBasisPoints: 7500, ProbabilityBasisPoints: 2500}, {PrizeID: secondPrize.Id, Weight: 3, ProbabilityBasisPoints: 7500}})
	require.NoError(t, err)
	require.NoError(t, db.Create(&LotteryDraw{UserId: first.Id, PrizeId: firstPrize.Id, PrizeName: firstPrize.Name, RewardQuota: 25, ProbabilitySnapshot: string(firstSnapshot), IdempotencyKey: "stats-1", CreatedAt: inRange}).Error)
	require.NoError(t, db.Create(&LotteryDraw{UserId: second.Id, PrizeId: secondPrize.Id, PrizeName: secondPrize.Name, ProbabilitySnapshot: string(secondSnapshot), IdempotencyKey: "stats-2", CreatedAt: inRange + 1}).Error)
	require.NoError(t, db.Create(&LotteryDraw{UserId: first.Id, PrizeId: firstPrize.Id, PrizeName: firstPrize.Name, RewardQuota: 25, ProbabilitySnapshot: string(firstSnapshot), IdempotencyKey: "stats-3", CreatedAt: outOfRange}).Error)

	stats, err := GetLotteryStats(inRange, inRange+10)
	require.NoError(t, err)
	require.EqualValues(t, 2, stats.TotalDraws)
	require.EqualValues(t, 2, stats.Participants)
	require.EqualValues(t, 25, stats.RewardQuota)
	require.Equal(t, 4, stats.PoolWeight)
	require.Len(t, stats.Prizes, 2)

	byID := make(map[int]LotteryPrizeStat, len(stats.Prizes))
	for _, prize := range stats.Prizes {
		byID[prize.ID] = prize
	}
	require.Equal(t, 5000, byID[firstPrize.Id].ConfiguredProbabilityBasisPoints)
	require.Equal(t, 5000, byID[firstPrize.Id].ActualProbabilityBasisPoints)
	require.EqualValues(t, 1, byID[firstPrize.Id].DrawCount)
	require.Zero(t, byID[secondPrize.Id].ConfiguredProbabilityBasisPoints)
	require.Equal(t, 5000, byID[secondPrize.Id].ActualProbabilityBasisPoints)
	require.EqualValues(t, 1, byID[secondPrize.Id].DrawCount)
}

func TestGetLotteryStatsKeepsDeletedPrizeHistory(t *testing.T) {
	db := setupLotteryTestDB(t)
	user := createLotteryTestUser(t, db, "lottery-stats-deleted")
	prize := &LotteryPrize{Name: "removed gift", PrizeType: LotteryPrizeGift, RewardQuota: 15, Weight: 1, Stock: -1, Enabled: true}
	require.NoError(t, UpsertLotteryPrize(prize))
	const timestamp int64 = 1_700_001_000
	require.NoError(t, db.Create(&LotteryDraw{UserId: user.Id, PrizeId: prize.Id, PrizeName: prize.Name, RewardQuota: prize.RewardQuota, IdempotencyKey: "stats-deleted-1", CreatedAt: timestamp}).Error)
	require.NoError(t, db.Delete(&LotteryPrize{}, prize.Id).Error)

	stats, err := GetLotteryStats(timestamp, timestamp)
	require.NoError(t, err)
	require.Len(t, stats.Prizes, 1)
	require.Equal(t, prize.Id, stats.Prizes[0].ID)
	require.Equal(t, prize.Name, stats.Prizes[0].Name)
	require.False(t, stats.Prizes[0].Configured)
	require.EqualValues(t, 1, stats.Prizes[0].DrawCount)
	require.Equal(t, 10000, stats.Prizes[0].ActualProbabilityBasisPoints)
}

func TestValidateLotterySettingsRejectsInvalidBatchBeforePersistence(t *testing.T) {
	setupLotteryTestDB(t)
	require.Error(t, ValidateLotterySettings(map[string]string{
		LotteryEnabledKey:                "false",
		LotteryDailyAttemptsKey:          "0",
		LotteryInviteRegisterKey:         "true",
		LotteryThresholdKey:              "100",
		LotteryKeepAttemptsKey:           "false",
		LotteryInviteRechargeKey:         "false",
		LotteryInviteRegisterAttemptsKey: "1",
	}))
}

func TestGrantLotteryAttemptIsAdditiveBeyondConsumptionDailyLimit(t *testing.T) {
	db := setupLotteryTestDB(t)
	user := createLotteryTestUser(t, db, "lottery-invite-bonus")
	common.OptionMapRWMutex.Lock()
	common.OptionMap[LotteryDailyAttemptsKey] = "1"
	common.OptionMapRWMutex.Unlock()

	require.NoError(t, RecordLotteryConsumption(user.Id, LotteryDailyThreshold()))
	require.NoError(t, GrantLotteryAttempt(user.Id, 3))

	status, err := GetLotteryStatus(user.Id)
	require.NoError(t, err)
	require.Equal(t, 4, status.GrantedAttempts)
}
