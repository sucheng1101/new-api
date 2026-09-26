package model

import (
	"testing"

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
