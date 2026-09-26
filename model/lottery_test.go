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
	require.Equal(t, 2, status.GrantedAttempts)

	require.Error(t, UpsertLotteryPrize(&LotteryPrize{Name: "invalid", PrizeType: "cash", Weight: 1, Stock: 1, Enabled: true}))
	require.Error(t, UpsertLotteryPrize(&LotteryPrize{Name: "invalid stock", PrizeType: LotteryPrizeNone, Weight: 1, Stock: -2, Enabled: true}))
	require.NoError(t, UpsertLotteryPrize(&LotteryPrize{Name: "no prize", PrizeType: LotteryPrizeNone, Weight: 1, Stock: -1, Enabled: true}))
	prizes, err := ListLotteryPrizes()
	require.NoError(t, err)
	require.Len(t, prizes, 1)
}
