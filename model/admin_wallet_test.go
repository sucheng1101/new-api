package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestAdminWalletGiftRechargeDebitAndCorrectionAreIdempotent(t *testing.T) {
	db := setupWalletTestDB(t)
	user := createWalletTestUser(t, db, "admin-wallet-mutations", 0, 0, 0, 0)
	const operatorID = 99

	require.NoError(t, AdminCreditWallet(user.Id, 100, operatorID, true, "admin-gift-1", "welcome gift"))
	require.NoError(t, AdminCreditWallet(user.Id, 100, operatorID, true, "admin-gift-1", "welcome gift"))
	require.NoError(t, AdminCreditWallet(user.Id, 200, operatorID, false, "admin-recharge-1", "manual recharge"))
	require.NoError(t, AdminCreditWallet(user.Id, 200, operatorID, false, "admin-recharge-1", "manual recharge"))

	balance, err := GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 200, Gift: 100, Promotion: 0, Total: 300}, balance)

	require.NoError(t, AdminDebitWallet(user.Id, 150, operatorID, "admin-debit-1", "manual reduction"))
	require.NoError(t, AdminDebitWallet(user.Id, 150, operatorID, "admin-debit-1", "manual reduction"))
	balance, err = GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 150, Gift: 0, Promotion: 0, Total: 150}, balance)

	require.NoError(t, AdminCorrectWallet(user.Id, WalletAccountGift, 25, operatorID, "admin-correction-gift", "balance correction"))
	require.NoError(t, AdminCorrectWallet(user.Id, WalletAccountGift, 25, operatorID, "admin-correction-gift", "balance correction"))
	require.NoError(t, AdminCorrectWallet(user.Id, WalletAccountCash, -75, operatorID, "admin-correction-cash", "balance correction"))
	require.NoError(t, AdminCorrectWallet(user.Id, WalletAccountCash, -75, operatorID, "admin-correction-cash", "balance correction"))

	balance, err = GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, WalletBalance{Cash: 75, Gift: 25, Promotion: 0, Total: 100}, balance)

	var operations, transactions int64
	require.NoError(t, db.Model(&AdminWalletOperation{}).Where("user_id = ?", user.Id).Count(&operations).Error)
	require.NoError(t, db.Model(&WalletTransaction{}).Where("user_id = ?", user.Id).Count(&transactions).Error)
	require.EqualValues(t, 5, operations)
	require.EqualValues(t, 6, transactions)
}

func TestAdminCashRechargeCreatesPromotionRewardsIndependentlyOfLottery(t *testing.T) {
	db := setupWalletTestDB(t)
	previousOptions := common.OptionMap
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{
		PromotionLevel1BasisPointsKey: "500",
		PromotionLevel2BasisPointsKey: "300",
		LotteryInviteRechargeKey:      "false",
		LotteryEnabledKey:             "false",
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	require.NoError(t, db.AutoMigrate(&LotteryDaily{}))

	level2 := User{Username: "admin-recharge-level2", Password: "wallet-test-password", Status: common.UserStatusEnabled, AffCode: "admin-recharge-level2-code"}
	require.NoError(t, db.Create(&level2).Error)
	level1 := User{Username: "admin-recharge-level1", Password: "wallet-test-password", Status: common.UserStatusEnabled, AffCode: "admin-recharge-level1-code"}
	require.NoError(t, db.Create(&level1).Error)
	level1.InviterId = level2.Id
	require.NoError(t, db.Save(&level1).Error)
	payer := User{Username: "admin-recharge-payer", Password: "wallet-test-password", Status: common.UserStatusEnabled, AffCode: "admin-recharge-payer-code"}
	require.NoError(t, db.Create(&payer).Error)
	payer.InviterId = level1.Id
	require.NoError(t, db.Save(&payer).Error)

	require.NoError(t, AdminCreditWallet(payer.Id, 1000, 99, false, "admin-recharge-rebate", "manual recharge"))
	require.NoError(t, AdminCreditWallet(payer.Id, 1000, 99, false, "admin-recharge-rebate", "manual recharge"))

	var level1Balance, level2Balance User
	require.NoError(t, db.First(&level1Balance, level1.Id).Error)
	require.NoError(t, db.First(&level2Balance, level2.Id).Error)
	require.Equal(t, 50, level1Balance.AffQuota)
	require.Equal(t, 30, level2Balance.AffQuota)
	var rewardCount, lotteryCount int64
	require.NoError(t, db.Model(&PromotionReward{}).Where("source_type = ?", "admin_wallet").Count(&rewardCount).Error)
	require.EqualValues(t, 2, rewardCount)
	require.NoError(t, db.Model(&LotteryDaily{}).Count(&lotteryCount).Error)
	require.Zero(t, lotteryCount)
}

func TestAdminCashRechargeLotteryIsIndependentOfPromotionRates(t *testing.T) {
	db := setupWalletTestDB(t)
	previousOptions := common.OptionMap
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{
		PromotionLevel1BasisPointsKey:    "0",
		PromotionLevel2BasisPointsKey:    "0",
		LotteryInviteRechargeKey:         "true",
		LotteryInviteRechargeAttemptsKey: "2",
		LotteryEnabledKey:                "true",
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	require.NoError(t, db.AutoMigrate(&LotteryDaily{}))

	inviter := User{Username: "admin-recharge-lottery-inviter", Password: "wallet-test-password", Status: common.UserStatusEnabled, AffCode: "admin-recharge-lottery-inviter-code"}
	require.NoError(t, db.Create(&inviter).Error)
	payer := User{Username: "admin-recharge-lottery-payer", Password: "wallet-test-password", Status: common.UserStatusEnabled, AffCode: "admin-recharge-lottery-payer-code"}
	require.NoError(t, db.Create(&payer).Error)
	payer.InviterId = inviter.Id
	require.NoError(t, db.Save(&payer).Error)

	require.NoError(t, AdminCreditWallet(payer.Id, 1000, 99, false, "admin-recharge-lottery", "manual recharge"))
	require.NoError(t, AdminCreditWallet(payer.Id, 1000, 99, false, "admin-recharge-lottery", "manual recharge"))

	status, err := GetLotteryStatus(inviter.Id)
	require.NoError(t, err)
	require.Equal(t, 2, status.GrantedAttempts)
	var rewards []PromotionReward
	require.NoError(t, db.Where("source_type = ?", "admin_wallet").Find(&rewards).Error)
	require.Len(t, rewards, 1)
	require.Equal(t, PromotionRewardRoundedZero, rewards[0].Status)
}

func TestAdminWalletRejectsInsufficientReductionWithoutMutation(t *testing.T) {
	db := setupWalletTestDB(t)
	user := createWalletTestUser(t, db, "admin-wallet-insufficient", 10, 0, 10, 0)

	err := AdminDebitWallet(user.Id, 11, 99, "admin-debit-too-large", "manual reduction")
	require.EqualError(t, err, "insufficient wallet balance")
	balance, balanceErr := GetWalletBalance(user.Id)
	require.NoError(t, balanceErr)
	require.Equal(t, WalletBalance{Cash: 0, Gift: 10, Promotion: 0, Total: 10}, balance)

	err = AdminCorrectWallet(user.Id, WalletAccountGift, -11, 99, "admin-correction-too-large", "balance correction")
	require.EqualError(t, err, "insufficient gift balance")
	balance, balanceErr = GetWalletBalance(user.Id)
	require.NoError(t, balanceErr)
	require.Equal(t, WalletBalance{Cash: 0, Gift: 10, Promotion: 0, Total: 10}, balance)

	var operations int64
	require.NoError(t, db.Model(&AdminWalletOperation{}).Count(&operations).Error)
	require.Zero(t, operations)
}
