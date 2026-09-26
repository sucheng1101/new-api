package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func AdminPromotionRelations(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var users []model.User
	q := model.DB.Select("id", "username", "inviter_id", "created_at").Order("id desc").Limit(limit)
	if id, _ := strconv.Atoi(c.Query("user_id")); id > 0 {
		q = q.Where("id = ?", id)
	}
	if err := q.Find(&users).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, users)
}

type AdminPromotionRelationRequest struct {
	InviterID int    `json:"inviter_id"`
	Reason    string `json:"reason"`
}

func AdminSetPromotionRelation(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("user_id"))
	if err != nil || userID <= 0 {
		common.ApiError(c, errors.New("invalid user id"))
		return
	}
	var req AdminPromotionRelationRequest
	if err = common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if err = model.SetUserInviterWithAudit(userID, req.InviterID, c.GetInt("id"), strings.TrimSpace(req.Reason)); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func AdminPromotionRewards(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows []model.PromotionReward
	q := model.DB.Order("id desc").Limit(limit)
	if status := c.Query("status"); status != "" {
		q = q.Where("status = ?", status)
	}
	if err := q.Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}
func AdminReleasePromotionReward(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := model.ReleasePromotionReward(id, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func AdminVoidPromotionReward(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req struct {
		Reason string `json:"reason"`
	}
	_ = common.DecodeJson(c.Request.Body, &req)
	if err := model.VoidPromotionReward(id, c.GetInt("id"), req.Reason); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func AdminPromotionRiskEvents(c *gin.Context) {
	var rows []model.PromotionRiskEvent
	q := model.DB.Order("id desc").Limit(100)
	if err := q.Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}

func AdminLotterySettings(c *gin.Context) {
	common.ApiSuccess(c, gin.H{"threshold": model.LotteryDailyThreshold(), "daily_attempts": model.LotteryDailyAttempts(), "keep_attempts": model.LotteryKeepAttempts(), "invite_register_enabled": model.LotteryInviteRegisterEnabled(), "invite_recharge_enabled": model.LotteryInviteRechargeEnabled()})
}
func UpdateAdminLotterySettings(c *gin.Context) {
	var values map[string]interface{}
	if err := common.DecodeJson(c.Request.Body, &values); err != nil {
		common.ApiError(c, err)
		return
	}
	keys := map[string]string{"threshold": model.LotteryThresholdKey, "daily_attempts": model.LotteryDailyAttemptsKey, "keep_attempts": model.LotteryKeepAttemptsKey, "invite_register_enabled": model.LotteryInviteRegisterKey, "invite_recharge_enabled": model.LotteryInviteRechargeKey}
	for name, key := range keys {
		if value, ok := values[name]; ok {
			if err := model.UpdateOption(key, common.Interface2String(value)); err != nil {
				common.ApiError(c, err)
				return
			}
		}
	}
	AdminLotterySettings(c)
}
func AdminLotteryDraws(c *gin.Context) {
	var rows []model.LotteryDraw
	q := model.DB.Order("id desc").Limit(100)
	if err := q.Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}
func AdminLotteryGrants(c *gin.Context) {
	var req struct {
		UserID int `json:"user_id"`
		Count  int `json:"count"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.GrantLotteryAttempt(req.UserID, req.Count); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func GetPromotionSummary(c *gin.Context) {
	summary, err := model.GetPromotionSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

func GetPromotionRewards(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rows, total, err := model.ListPromotionRewards(c.GetInt("id"), limit, offset)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "total": total, "limit": limit, "offset": offset})
}

func GetPromotionInvitees(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rows, total, err := model.ListPromotionInvitees(c.GetInt("id"), limit, offset)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "total": total, "limit": limit, "offset": offset})
}

func GetLotteryStatus(c *gin.Context) {
	status, err := model.GetLotteryStatus(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	prizes, prizeErr := model.ListLotteryPrizes()
	if prizeErr != nil {
		common.ApiError(c, prizeErr)
		return
	}
	enabled := make([]model.LotteryPrize, 0, len(prizes))
	for _, prize := range prizes {
		if prize.Enabled && prize.Weight > 0 && prize.Stock != 0 {
			enabled = append(enabled, prize)
		}
	}
	common.ApiSuccess(c, gin.H{"status": status, "threshold": model.LotteryDailyThreshold(), "daily_attempts": model.LotteryDailyAttempts(), "keep_attempts": model.LotteryKeepAttempts(), "invite_register_enabled": model.LotteryInviteRegisterEnabled(), "invite_recharge_enabled": model.LotteryInviteRechargeEnabled(), "prizes": enabled})
}

type LotteryDrawRequest struct {
	IdempotencyKey string `json:"idempotency_key"`
}

func DrawLottery(c *gin.Context) {
	var request LotteryDrawRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	if request.IdempotencyKey == "" {
		request.IdempotencyKey = common.GetUUID()
	}
	draw, err := model.DrawLottery(c.GetInt("id"), request.IdempotencyKey)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, draw)
}

func GetLotteryDraws(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rows, total, err := model.ListLotteryDraws(c.GetInt("id"), limit, offset)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "total": total, "limit": limit, "offset": offset})
}

func ListAdminLotteryPrizes(c *gin.Context) {
	prizes, err := model.ListLotteryPrizes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, prizes)
}

func UpsertAdminLotteryPrize(c *gin.Context) {
	var prize model.LotteryPrize
	if err := common.DecodeJson(c.Request.Body, &prize); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpsertLotteryPrize(&prize); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, prize)
}

func DeleteAdminLotteryPrize(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiError(c, errors.New("invalid lottery prize id"))
		return
	}
	if err = model.DeleteLotteryPrize(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
