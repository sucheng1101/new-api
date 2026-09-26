package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type AdminWalletRefundRequest struct {
	SourceType           string `json:"source_type" binding:"required"`
	SourceID             int    `json:"source_id" binding:"required"`
	Amount               int    `json:"amount" binding:"required"`
	IdempotencyKey       string `json:"idempotency_key"`
	Reason               string `json:"reason"`
	PreviewRefundedQuota *int   `json:"preview_refunded_quota"`
	PreviewAmount        *int   `json:"preview_amount"`
	PreviewFingerprint   string `json:"preview_fingerprint"`
	PreviewSourceVersion string `json:"preview_source_version"`
	PreviewPromotionCost *int   `json:"preview_promotion_cost"`
}

type AdminWalletMutationRequest struct {
	UserID         int    `json:"user_id" binding:"required"`
	Amount         int    `json:"amount" binding:"required"`
	IdempotencyKey string `json:"idempotency_key"`
	Reason         string `json:"reason"`
	AccountType    string `json:"account_type"`
}

func AdminPreviewWalletRefund(c *gin.Context) {
	var req AdminWalletRefundRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.SourceType = strings.ToLower(strings.TrimSpace(req.SourceType))
	preview, err := model.PreviewWalletRefund(req.SourceType, req.SourceID, req.Amount)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, preview)
}

func adminMutation(c *gin.Context, gift, debit bool) {
	var req AdminWalletMutationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = common.GetUUID()
	}
	var err error
	if debit {
		err = model.AdminDebitWallet(req.UserID, req.Amount, c.GetInt("id"), req.IdempotencyKey, req.Reason)
	} else {
		err = model.AdminCreditWallet(req.UserID, req.Amount, c.GetInt("id"), gift, req.IdempotencyKey, req.Reason)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"idempotency_key": req.IdempotencyKey})
}

func AdminWalletRecharge(c *gin.Context) { adminMutation(c, false, false) }
func AdminWalletGift(c *gin.Context)     { adminMutation(c, true, false) }
func AdminWalletCorrection(c *gin.Context) {
	var req AdminWalletMutationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = common.GetUUID()
	}
	if err := model.AdminCorrectWallet(req.UserID, strings.ToLower(strings.TrimSpace(req.AccountType)), req.Amount, c.GetInt("id"), req.IdempotencyKey, req.Reason); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"idempotency_key": req.IdempotencyKey})
}

func AdminWalletAdjustments(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows []model.AdminWalletOperation
	query := model.DB.Model(&model.AdminWalletOperation{}).Order("id desc").Limit(limit)
	if userID, _ := strconv.Atoi(c.Query("user_id")); userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if err := query.Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}

// AdminRefundWalletSource records a refund after the administrator has
// confirmed the external payment reversal. Users have no refund endpoint.
func AdminRefundWalletSource(c *gin.Context) {
	var req AdminWalletRefundRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.SourceType = strings.ToLower(strings.TrimSpace(req.SourceType))
	if req.SourceType != "topup" && req.SourceType != "redemption" && req.SourceType != "history_migration" {
		common.ApiError(c, errors.New("unsupported refund source"))
		return
	}
	if req.SourceID <= 0 || req.Amount <= 0 {
		common.ApiError(c, errors.New("refund amount must be positive"))
		return
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = common.GetUUID()
	}
	if req.PreviewFingerprint == "" || req.PreviewAmount == nil || *req.PreviewAmount != req.Amount || req.PreviewRefundedQuota == nil || req.PreviewPromotionCost == nil || req.PreviewSourceVersion == "" {
		common.ApiError(c, errors.New("refund preview is required"))
		return
	}
	preview, err := model.PreviewWalletRefund(req.SourceType, req.SourceID, req.Amount)
	if err != nil || preview.SnapshotFingerprint != req.PreviewFingerprint || preview.RefundedQuota != *req.PreviewRefundedQuota || preview.SourceVersion != req.PreviewSourceVersion || preview.PromotionCost != *req.PreviewPromotionCost {
		common.ApiError(c, errors.New("refund preview is stale"))
		return
	}
	operatorID := c.GetInt("id")
	refund, err := model.RefundWalletSource(req.SourceType, req.SourceID, req.Amount, operatorID, req.IdempotencyKey, req.Reason, req.PreviewFingerprint)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, refund)
}
