package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestWalletFundingSettlesAndRefundsOriginalSources(t *testing.T) {
	truncate(t)
	user := &model.User{Username: "wallet-funding", Password: "test-password", Status: 1}
	require.NoError(t, model.DB.Create(user).Error)
	require.NoError(t, model.CreditCash(user.Id, 100, 1, "topup", "order-1", model.WalletBusinessCashCredit, "funding-cash", true, 0, ""))
	require.NoError(t, model.CreditGift(user.Id, 30, 2, "admin_gift", "gift-1", model.WalletBusinessGiftCredit, "funding-gift", 0, ""))

	funding := &WalletFunding{userId: user.Id, requestId: "request-funding"}
	require.NoError(t, funding.PreConsume(50))
	require.NoError(t, funding.Settle(-15))
	require.NoError(t, funding.Settle(25))

	balance, err := model.GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, model.WalletBalance{Cash: 70, Gift: 0, Promotion: 0, Total: 70}, balance)

	require.NoError(t, funding.Refund())
	require.NoError(t, funding.Refund())
	balance, err = model.GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, model.WalletBalance{Cash: 100, Gift: 30, Promotion: 0, Total: 130}, balance)

	var lots []model.WalletCashLot
	require.NoError(t, model.DB.Where("user_id = ?", user.Id).Find(&lots).Error)
	require.Len(t, lots, 1)
	require.Zero(t, lots[0].ConsumedQuota)
}

func TestWalletFundingReserveRollbackCanBeRetried(t *testing.T) {
	truncate(t)
	user := &model.User{Username: "wallet-reserve-retry", Password: "test-password", Status: 1}
	require.NoError(t, model.DB.Create(user).Error)
	require.NoError(t, model.CreditCash(user.Id, 100, 1, "topup", "order-2", model.WalletBusinessCashCredit, "retry-cash", true, 0, ""))

	funding := &WalletFunding{userId: user.Id, requestId: "request-reserve-retry"}
	require.NoError(t, funding.PreConsume(10))
	require.NoError(t, funding.Settle(5))
	require.NoError(t, funding.Settle(-5))
	require.NoError(t, funding.Settle(5))

	balance, err := model.GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, 85, balance.Total)
	require.Equal(t, 15, funding.consumed)
}

func TestPostConsumeQuotaUsesWalletAllocationsForRepeatedCharges(t *testing.T) {
	truncate(t)
	user := &model.User{Username: "wallet-direct", Password: "test-password", Status: 1}
	require.NoError(t, model.DB.Create(user).Error)
	require.NoError(t, model.CreditCash(user.Id, 100, 1, "topup", "order-direct", model.WalletBusinessCashCredit, "direct-cash", true, 0, ""))
	require.NoError(t, model.CreditGift(user.Id, 20, 2, "admin_gift", "gift-direct", model.WalletBusinessGiftCredit, "direct-gift", 0, ""))

	info := &relaycommon.RelayInfo{UserId: user.Id, RequestId: "request-direct", IsPlayground: true}
	require.NoError(t, PostConsumeQuota(info, 15, 0, false))
	require.NoError(t, PostConsumeQuota(info, 15, 0, false))

	balance, err := model.GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, model.WalletBalance{Cash: 90, Gift: 0, Promotion: 0, Total: 90}, balance)

	var allocations []model.WalletConsumptionAllocation
	require.NoError(t, model.DB.Where("user_id = ? AND request_id = ?", user.Id, info.RequestId).Find(&allocations).Error)
	require.Len(t, allocations, 3)
}
