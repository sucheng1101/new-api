package model

import (
	"sync"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupWalletTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(
		&User{},
		&AdminWalletOperation{},
		&WalletOperation{},
		&WalletTransaction{},
		&WalletCashLot{},
		&WalletConsumptionAllocation{},
		&PromotionReward{},
	))
	previousDB := DB
	DB = db
	t.Cleanup(func() { DB = previousDB })
	return db
}

func createWalletTestUser(t *testing.T, db *gorm.DB, username string, quota, cash, gift, promotion int) User {
	t.Helper()
	user := User{Username: username, Password: "wallet-test-password", Quota: quota, CashQuota: cash, GiftQuota: gift, AffQuota: promotion}
	require.NoError(t, db.Create(&user).Error)
	return user
}

func TestWalletDebitUsesGiftThenCashFIFOAndRestoresSources(t *testing.T) {
	db := setupWalletTestDB(t)
	user := createWalletTestUser(t, db, "wallet-fifo", 0, 0, 0, 0)

	require.NoError(t, CreditCash(user.Id, 40, 1, "topup", "topup-1", WalletBusinessCashCredit, "credit-cash-1", true, 0, ""))
	require.NoError(t, CreditCash(user.Id, 50, 2, "topup", "topup-2", WalletBusinessCashCredit, "credit-cash-2", true, 0, ""))
	require.NoError(t, CreditGift(user.Id, 30, 3, "admin_gift", "gift-1", WalletBusinessGiftCredit, "credit-gift-1", 7, "test gift"))

	require.NoError(t, DebitWallet(user.Id, 80, "request-1", "debit-request-1"))

	balance, err := GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 40, Gift: 0, Promotion: 0, Total: 40}, balance)

	var lots []WalletCashLot
	require.NoError(t, db.Order("id asc").Find(&lots).Error)
	require.Len(t, lots, 2)
	require.Equal(t, 40, lots[0].ConsumedQuota)
	require.Equal(t, 10, lots[1].ConsumedQuota)

	var allocations []WalletConsumptionAllocation
	require.NoError(t, db.Where("request_id = ?", "request-1").Order("id asc").Find(&allocations).Error)
	require.Len(t, allocations, 3)
	require.Equal(t, WalletAccountGift, allocations[0].AccountType)
	require.Equal(t, 30, allocations[0].Quota)
	require.Equal(t, lots[0].Id, allocations[1].CashLotId)
	require.Equal(t, 40, allocations[1].Quota)
	require.Equal(t, lots[1].Id, allocations[2].CashLotId)
	require.Equal(t, 10, allocations[2].Quota)

	require.NoError(t, RestoreWalletAllocations(user.Id, "request-1", "restore-request-1"))
	require.NoError(t, RestoreWalletAllocations(user.Id, "request-1", "restore-request-1"))

	balance, err = GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 90, Gift: 30, Promotion: 0, Total: 120}, balance)
	require.NoError(t, db.Order("id asc").Find(&lots).Error)
	require.Zero(t, lots[0].ConsumedQuota)
	require.Zero(t, lots[1].ConsumedQuota)
	for _, allocation := range allocations {
		var refreshed WalletConsumptionAllocation
		require.NoError(t, db.First(&refreshed, allocation.Id).Error)
		require.Equal(t, WalletAllocationRestored, refreshed.Status)
	}
}

func TestWalletCreditAndDebitAreIdempotent(t *testing.T) {
	db := setupWalletTestDB(t)
	user := createWalletTestUser(t, db, "wallet-idempotent", 0, 0, 0, 0)

	require.NoError(t, CreditCash(user.Id, 100, 1, "topup", "order-1", WalletBusinessCashCredit, "credit-once", true, 0, ""))
	require.NoError(t, CreditCash(user.Id, 100, 1, "topup", "order-1", WalletBusinessCashCredit, "credit-once", true, 0, ""))
	require.NoError(t, DebitWallet(user.Id, 35, "request-idempotent", "debit-once"))
	require.NoError(t, DebitWallet(user.Id, 35, "request-idempotent", "debit-once"))

	balance, err := GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, 65, balance.Cash)
	require.Equal(t, 65, balance.Total)

	var lotCount, allocationCount int64
	require.NoError(t, db.Model(&WalletCashLot{}).Count(&lotCount).Error)
	require.NoError(t, db.Model(&WalletConsumptionAllocation{}).Count(&allocationCount).Error)
	require.EqualValues(t, 1, lotCount)
	require.EqualValues(t, 1, allocationCount)
}

func TestWalletPartialRestoreUsesLatestAllocationFirst(t *testing.T) {
	db := setupWalletTestDB(t)
	user := createWalletTestUser(t, db, "wallet-partial-restore", 0, 0, 0, 0)

	require.NoError(t, CreditCash(user.Id, 40, 1, "topup", "topup-1", WalletBusinessCashCredit, "partial-cash-1", true, 0, ""))
	require.NoError(t, CreditCash(user.Id, 50, 2, "topup", "topup-2", WalletBusinessCashCredit, "partial-cash-2", true, 0, ""))
	require.NoError(t, CreditGift(user.Id, 30, 3, "admin_gift", "gift-1", WalletBusinessGiftCredit, "partial-gift-1", 0, ""))
	require.NoError(t, DebitWallet(user.Id, 80, "request-partial", "partial-debit"))

	require.NoError(t, RestoreWalletAllocationsQuota(user.Id, "request-partial", 25, "partial-restore-25"))
	require.NoError(t, RestoreWalletAllocationsQuota(user.Id, "request-partial", 25, "partial-restore-25"))

	balance, err := GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 65, Gift: 0, Promotion: 0, Total: 65}, balance)

	var lots []WalletCashLot
	require.NoError(t, db.Order("id asc").Find(&lots).Error)
	require.Len(t, lots, 2)
	require.Equal(t, 25, lots[0].ConsumedQuota)
	require.Zero(t, lots[1].ConsumedQuota)

	var allocations []WalletConsumptionAllocation
	require.NoError(t, db.Where("request_id = ?", "request-partial").Order("id asc").Find(&allocations).Error)
	require.Len(t, allocations, 3)
	require.Zero(t, allocations[0].RestoredQuota)
	require.Equal(t, 15, allocations[1].RestoredQuota)
	require.Equal(t, WalletAllocationActive, allocations[1].Status)
	require.Equal(t, 10, allocations[2].RestoredQuota)
	require.Equal(t, WalletAllocationRestored, allocations[2].Status)

	require.NoError(t, RestoreWalletAllocationsQuota(user.Id, "request-partial", 55, "partial-restore-rest"))
	balance, err = GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 90, Gift: 30, Promotion: 0, Total: 120}, balance)
	require.NoError(t, db.Order("id asc").Find(&lots).Error)
	require.Zero(t, lots[0].ConsumedQuota)
	require.Zero(t, lots[1].ConsumedQuota)
}

func TestWalletRejectsInsufficientBalanceWithoutPartialMutation(t *testing.T) {
	db := setupWalletTestDB(t)
	user := createWalletTestUser(t, db, "wallet-insufficient", 0, 0, 0, 0)
	require.NoError(t, CreditGift(user.Id, 10, 1, "admin_gift", "gift", WalletBusinessGiftCredit, "gift-credit", 0, ""))

	require.Error(t, DebitWallet(user.Id, 11, "request-too-large", "debit-too-large"))
	balance, err := GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 0, Gift: 10, Promotion: 0, Total: 10}, balance)

	var count int64
	require.NoError(t, db.Model(&WalletOperation{}).Where("idempotency_key = ?", "debit-too-large").Count(&count).Error)
	require.Zero(t, count)
}

func TestWalletConcurrentIdempotentCreditOnlyAppliesOnce(t *testing.T) {
	db := setupWalletTestDB(t)
	user := createWalletTestUser(t, db, "wallet-concurrent-idempotent", 0, 0, 0, 0)

	const workers = 8
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- CreditCash(user.Id, 100, 1, "topup", "concurrent-order", WalletBusinessCashCredit, "concurrent-credit", true, 0, "")
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	balance, err := GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 100, Gift: 0, Promotion: 0, Total: 100}, balance)

	var operations, lots int64
	require.NoError(t, db.Model(&WalletOperation{}).Where("idempotency_key = ?", "concurrent-credit").Count(&operations).Error)
	require.NoError(t, db.Model(&WalletCashLot{}).Where("user_id = ?", user.Id).Count(&lots).Error)
	require.EqualValues(t, 1, operations)
	require.EqualValues(t, 1, lots)
}

func TestWalletMigrationBackfillsLegacyBalancesOnce(t *testing.T) {
	db := setupWalletTestDB(t)
	user := createWalletTestUser(t, db, "wallet-migration", 100, 0, 0, 9)

	require.NoError(t, migrateWalletBalances())
	require.NoError(t, migrateWalletBalances())

	var refreshed User
	require.NoError(t, db.First(&refreshed, user.Id).Error)
	require.Equal(t, 100, refreshed.Quota)
	require.Equal(t, 100, refreshed.CashQuota)
	require.Zero(t, refreshed.GiftQuota)
	require.Equal(t, 9, refreshed.AffQuota)

	var lots []WalletCashLot
	require.NoError(t, db.Where("user_id = ?", user.Id).Find(&lots).Error)
	require.Len(t, lots, 1)
	require.Equal(t, 100, lots[0].InitialQuota)
	require.True(t, lots[0].Refundable)

	var operations, transactions int64
	require.NoError(t, db.Model(&WalletOperation{}).Where("user_id = ?", user.Id).Count(&operations).Error)
	require.NoError(t, db.Model(&WalletTransaction{}).Where("user_id = ?", user.Id).Count(&transactions).Error)
	require.EqualValues(t, 2, operations)
	require.EqualValues(t, 2, transactions)
}
