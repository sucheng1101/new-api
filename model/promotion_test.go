package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPromotionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &Redemption{}, &PromotionReward{}, &PromotionRelationAudit{}, &PromotionConfigAudit{}, &PromotionRiskEvent{}, &WalletOperation{}, &WalletTransaction{}, &WalletCashLot{}, &WalletConsumptionAllocation{}))
	previousDB := DB
	DB = db
	previousOptions := common.OptionMap
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{PromotionLevel1BasisPointsKey: "500", PromotionLevel2BasisPointsKey: "300"}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	return db
}

func TestRedeemCreditsRefundableCashAndPromotion(t *testing.T) {
	db := setupPromotionTestDB(t)
	inviter := &User{Username: "redemption-inviter", AffCode: "ri", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(inviter).Error)
	user := &User{Username: "redemption-user", AffCode: "ru", Status: common.UserStatusEnabled, InviterId: inviter.Id}
	require.NoError(t, db.Create(user).Error)
	code := &Redemption{Key: "redemption-promotion-key", Status: common.RedemptionCodeStatusEnabled, Quota: 200, CreatedTime: common.GetTimestamp()}
	require.NoError(t, db.Create(code).Error)
	quota, err := Redeem(code.Key, user.Id)
	require.NoError(t, err)
	require.Equal(t, 200, quota)
	var lot WalletCashLot
	require.NoError(t, db.Where("source_type = ? AND source_id = ?", "redemption", code.Id).First(&lot).Error)
	require.True(t, lot.Refundable)
	require.Equal(t, 200, lot.InitialQuota)
	var reward PromotionReward
	require.NoError(t, db.Where("source_type = ? AND source_id = ?", "redemption", code.Id).First(&reward).Error)
	require.Equal(t, 10, reward.RewardQuota)
}

func TestSettleTopUpSuccessCreditsTwoLevelsExactlyOnce(t *testing.T) {
	db := setupPromotionTestDB(t)
	a := &User{Username: "promotion-a", AffCode: "pa", Status: common.UserStatusEnabled, Quota: 0, CashQuota: 0, GiftQuota: 0}
	b := &User{Username: "promotion-b", AffCode: "pb", Status: common.UserStatusEnabled, Quota: 0, CashQuota: 0, GiftQuota: 0, InviterId: 0}
	require.NoError(t, db.Create(a).Error)
	b.InviterId = a.Id
	require.NoError(t, db.Create(b).Error)
	c := &User{Username: "promotion-c", AffCode: "pc", Status: common.UserStatusEnabled, Quota: 0, CashQuota: 0, GiftQuota: 0, InviterId: b.Id}
	require.NoError(t, db.Create(c).Error)
	topUp := &TopUp{UserId: c.Id, Amount: 1000, Money: 10, TradeNo: "promotion-order-1", PaymentProvider: PaymentProviderCreem, PaymentMethod: PaymentMethodCreem, Status: common.TopUpStatusPending, CreateTime: time.Now().Unix()}
	require.NoError(t, db.Create(topUp).Error)
	settled, newlySettled, err := SettleTopUpSuccess(topUp.TradeNo, PaymentProviderCreem, 1000, "127.0.0.1", nil)
	require.NoError(t, err)
	require.True(t, newlySettled)
	require.Equal(t, 80, settled.PromotionRewardTotal)
	var refreshedA, refreshedB, refreshedC User
	require.NoError(t, db.First(&refreshedA, a.Id).Error)
	require.NoError(t, db.First(&refreshedB, b.Id).Error)
	require.NoError(t, db.First(&refreshedC, c.Id).Error)
	require.Equal(t, 30, refreshedA.AffQuota)
	require.Equal(t, 50, refreshedB.AffQuota)
	require.Equal(t, 1000, refreshedC.CashQuota)
	_, newlySettled, err = SettleTopUpSuccess(topUp.TradeNo, PaymentProviderCreem, 1000, "127.0.0.1", nil)
	require.NoError(t, err)
	require.False(t, newlySettled)
	require.NoError(t, db.First(&refreshedB, b.Id).Error)
	require.Equal(t, 50, refreshedB.AffQuota)
	var rewardCount int64
	require.NoError(t, db.Model(&PromotionReward{}).Count(&rewardCount).Error)
	require.EqualValues(t, 2, rewardCount)
}

func TestPromotionRewardFrozenAndRoundedZeroKeepAuditRows(t *testing.T) {
	db := setupPromotionTestDB(t)
	a := &User{Username: "promotion-frozen-a", AffCode: "pfa", Status: common.UserStatusDisabled, Quota: 0, CashQuota: 0, GiftQuota: 0}
	require.NoError(t, db.Create(a).Error)
	b := &User{Username: "promotion-frozen-b", AffCode: "pfb", Status: common.UserStatusEnabled, Quota: 0, CashQuota: 0, GiftQuota: 0, InviterId: a.Id}
	require.NoError(t, db.Create(b).Error)
	require.NoError(t, CreatePromotionRewardsTx(db, "topup", 99, "frozen-source", b.Id, 100))
	var rewards []PromotionReward
	require.NoError(t, db.Order("level asc").Find(&rewards).Error)
	require.Len(t, rewards, 1)
	require.Equal(t, PromotionRewardFrozen, rewards[0].Status)
	require.Equal(t, 5, rewards[0].RewardQuota)
	common.OptionMapRWMutex.Lock()
	common.OptionMap[PromotionLevel1BasisPointsKey] = "1"
	common.OptionMap[PromotionLevel2BasisPointsKey] = "1"
	common.OptionMapRWMutex.Unlock()
	require.NoError(t, CreatePromotionRewardsTx(db, "topup", 100, "rounded-source", b.Id, 1))
	var rounded PromotionReward
	require.NoError(t, db.Where("source_id = ?", 100).First(&rounded).Error)
	require.Equal(t, PromotionRewardRoundedZero, rounded.Status)
	require.Equal(t, 0, rounded.RewardQuota)
}

func TestTransferPromotionToGiftIsAtomicAndIdempotent(t *testing.T) {
	db := setupPromotionTestDB(t)
	user := &User{Username: "promotion-transfer", AffCode: "pt", Status: common.UserStatusEnabled, Quota: 0, CashQuota: 0, GiftQuota: 0, AffQuota: 40, AffHistoryQuota: 40}
	require.NoError(t, db.Create(user).Error)
	require.NoError(t, TransferPromotionToGiftTx(db, user.Id, 25, "promotion-transfer-once"))
	require.NoError(t, TransferPromotionToGiftTx(db, user.Id, 25, "promotion-transfer-once"))
	var refreshed User
	require.NoError(t, db.First(&refreshed, user.Id).Error)
	require.Equal(t, 15, refreshed.AffQuota)
	require.Equal(t, 25, refreshed.GiftQuota)
	require.Equal(t, 25, refreshed.Quota)
}
