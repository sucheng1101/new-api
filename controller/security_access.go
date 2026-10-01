package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type securityIPBlockRequest struct {
	Address string `json:"address"`
	Reason  string `json:"reason"`
	Enabled *bool  `json:"enabled"`
}

func securityTimeRange(c *gin.Context) (int64, int64) {
	start, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	return start, end
}

func GetSecuritySummary(c *gin.Context) {
	start, end := securityTimeRange(c)
	count := func(value int64, err error) (int64, bool) {
		if err != nil {
			common.ApiError(c, err)
			return 0, false
		}
		return value, true
	}
	auditEvents, ok := count(model.CountAuditEvents(start, end))
	if !ok {
		return
	}
	distinctIPs, ok := count(model.CountDistinctAuditIPs(start, end))
	if !ok {
		return
	}
	registrations, ok := count(model.CountAuditAction("register", start, end))
	if !ok {
		return
	}
	logins, ok := count(model.CountAuditAction("login", start, end))
	if !ok {
		return
	}
	failedLogins, ok := count(model.CountAuditAction("login.failed", start, end))
	if !ok {
		return
	}
	walletActions, ok := count(model.CountAuditActionPrefix("wallet.", start, end))
	if !ok {
		return
	}
	activeBlocks, ok := count(model.CountActiveSecurityIPBlocks())
	if !ok {
		return
	}
	common.ApiSuccess(c, gin.H{
		"audit_events":   auditEvents,
		"distinct_ips":   distinctIPs,
		"registrations":  registrations,
		"logins":         logins,
		"failed_logins":  failedLogins,
		"wallet_actions": walletActions,
		"active_blocks":  activeBlocks,
	})
}

func GetSecurityEvents(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	start, end := securityTimeRange(c)
	var success *bool
	if value := strings.TrimSpace(c.Query("success")); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			common.ApiErrorMsg(c, "success 参数错误")
			return
		}
		success = &parsed
	}
	logs, total, err := model.GetAuditLogs(model.AuditLogFilter{
		Category: c.Query("category"), Action: c.Query("action"), Ip: c.Query("ip"),
		Username: c.Query("username"), StartTimestamp: start, EndTimestamp: end, Success: success,
	}, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

func GetSecurityIPRisks(c *gin.Context) {
	start, end := securityTimeRange(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	risks, err := model.GetSecurityIPRisks(start, end, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, risks)
}

func GetSecurityIPBlocks(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListSecurityIPBlocks(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func CreateSecurityIPBlock(c *gin.Context) {
	var req securityIPBlockRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Address) == "" {
		common.ApiErrorMsg(c, "IP 地址不能为空或格式错误")
		return
	}
	item, err := model.CreateSecurityIPBlock(req.Address, req.Reason, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, item)
}

func UpdateSecurityIPBlock(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "IP 黑名单 ID 无效")
		return
	}
	var req securityIPBlockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Enabled == nil {
		common.ApiErrorMsg(c, "缺少 enabled 参数")
		return
	}
	if err := model.SetSecurityIPBlockEnabled(id, *req.Enabled); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id, "enabled": *req.Enabled})
}

func DeleteSecurityIPBlock(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "IP 黑名单 ID 无效")
		return
	}
	if err := model.DeleteSecurityIPBlock(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}
