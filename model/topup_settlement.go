package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// SettleTopUpSuccess atomically marks one pending top-up successful, credits a
// refundable cash lot, and creates both promotion snapshots. It is deliberately
// the only successful top-up settlement path used by payment callbacks and
// administrator completion.
func SettleTopUpSuccess(tradeNo, expectedProvider string, creditedQuota int, callbackIP string, updates map[string]interface{}) (*TopUp, bool, error) {
	if tradeNo == "" || creditedQuota <= 0 {
		return nil, false, errors.New("invalid top-up settlement")
	}
	var settled TopUp
	newlySettled := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		refCol := "`trade_no`"
		if common.UsingPostgreSQL {
			refCol = `"trade_no"`
		}
		locked := &TopUp{}
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(locked).Error; err != nil {
			return ErrTopUpNotFound
		}
		if expectedProvider != "" && locked.PaymentProvider != expectedProvider {
			return ErrPaymentMethodMismatch
		}
		if locked.Status == common.TopUpStatusSuccess {
			if locked.CreditedQuota > 0 && locked.CreditedQuota != creditedQuota {
				return errors.New("top-up was settled with a different quota")
			}
			settled = *locked
			return nil
		}
		if locked.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}
		if paymentMethod, ok := updates["payment_method"]; ok {
			if err := tx.Model(locked).Update("payment_method", paymentMethod).Error; err != nil {
				return err
			}
			locked.PaymentMethod, _ = paymentMethod.(string)
		}
		if stripeCustomer, ok := updates["stripe_customer"]; ok {
			if err := tx.Model(&User{}).Where("id = ?", locked.UserId).Update("stripe_customer", stripeCustomer).Error; err != nil {
				return err
			}
		}
		if email, ok := updates["email"]; ok {
			if err := tx.Model(&User{}).Where("id = ? AND email = ?", locked.UserId, "").Update("email", email).Error; err != nil {
				return err
			}
		}
		level1, level2 := PromotionRates()
		locked.Status = common.TopUpStatusSuccess
		locked.CompleteTime = common.GetTimestamp()
		locked.SettledAt = locked.CompleteTime
		locked.CreditedQuota = creditedQuota
		locked.PromotionLevel1BasisPoints = level1
		locked.PromotionLevel2BasisPoints = level2
		locked.PromotionRewardTotal = 0
		locked.CallbackIP = callbackIP
		if err := tx.Save(locked).Error; err != nil {
			return err
		}
		if err := CreditCashTx(tx, locked.UserId, creditedQuota, locked.Id, "topup", locked.TradeNo, WalletBusinessCashCredit, "topup:"+locked.TradeNo, true, 0, "充值到账"); err != nil {
			return err
		}
		if err := CreatePromotionRewardsWithRatesTx(tx, "topup", locked.Id, locked.TradeNo, locked.UserId, creditedQuota, level1, level2); err != nil {
			return err
		}
		if err := tx.Model(&PromotionReward{}).Where("source_type = ? AND source_id = ?", "topup", locked.Id).Select("COALESCE(SUM(reward_quota), 0)").Scan(&locked.PromotionRewardTotal).Error; err != nil {
			return err
		}
		if err := tx.Model(locked).Update("promotion_reward_total", locked.PromotionRewardTotal).Error; err != nil {
			return err
		}
		var payer User
		if err := tx.Select("id", "register_ip", "inviter_id").First(&payer, locked.UserId).Error; err == nil && payer.InviterId > 0 {
			var inviter User
			if err := tx.Select("id", "register_ip").First(&inviter, payer.InviterId).Error; err == nil && inviter.RegisterIP != "" && (payer.RegisterIP == inviter.RegisterIP || locked.CreateIP == inviter.RegisterIP) {
				if err := tx.Create(&PromotionRiskEvent{EventType: "shared_inviter_ip", UserId: payer.Id, RelatedUserId: inviter.Id, SourceType: "topup", SourceId: locked.Id, IP: locked.CreateIP, RelatedIP: inviter.RegisterIP, Message: "充值用户与邀请人存在相同 IP，请管理员人工核查", CreatedAt: common.GetTimestamp()}).Error; err != nil {
					return err
				}
			}
		}
		settled = *locked
		newlySettled = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	invalidateWalletUserCache(settled.UserId, nil)
	var rewards []PromotionReward
	if DB.Where("source_type = ? AND source_id = ?", "topup", settled.Id).Find(&rewards).Error == nil {
		for _, reward := range rewards {
			invalidateWalletUserCache(reward.BeneficiaryUserId, nil)
		}
	}
	return &settled, newlySettled, nil
}

func TopUpQuota(topUp *TopUp) (int, error) {
	if topUp == nil {
		return 0, errors.New("top-up is nil")
	}
	if topUp.CreditedQuota > 0 {
		return topUp.CreditedQuota, nil
	}
	if topUp.PaymentProvider == PaymentProviderCreem {
		if topUp.Amount <= 0 {
			return 0, errors.New("无效的充值额度")
		}
		return int(topUp.Amount), nil
	}
	amount := int(topUp.Amount)
	if topUp.PaymentProvider == PaymentProviderStripe {
		amount = int(decimal.NewFromFloat(topUp.Money).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
	} else {
		amount = int(decimal.NewFromInt(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
	}
	if amount <= 0 {
		return 0, fmt.Errorf("无效的充值额度")
	}
	return amount, nil
}
