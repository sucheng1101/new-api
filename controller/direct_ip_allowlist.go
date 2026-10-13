package controller

import (
	"errors"
	"net"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type directIPAllowlistRequest struct {
	IP     string `json:"ip"`
	Remark string `json:"remark"`
}

type directIPAllowlistAdminRequest struct {
	Enabled *bool `json:"enabled"`
}

func GetDirectIPAllowlist(c *gin.Context) {
	entries, err := model.GetDirectIPAllowlists(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":        entries,
		"count":        len(entries),
		"max":          model.DirectIPAllowlistMaxEntries,
		"base_url":     common.DirectAPIBaseURL(),
		"direct_hosts": common.DirectAPIHosts(),
	})
}

func GetDirectIPAllowlistCurrentIP(c *gin.Context) {
	clientIP := strings.TrimSpace(c.ClientIP())
	ip := net.ParseIP(clientIP)
	ipv4 := ""
	ipv6 := ""
	if ip != nil {
		if v4 := ip.To4(); v4 != nil {
			ipv4 = v4.String()
		} else {
			ipv6 = ip.String()
		}
	}
	common.ApiSuccess(c, gin.H{
		"ipv4":            ipv4,
		"ipv6":            ipv6,
		"supports_ipv4":   ipv4 != "",
		"direct_base_url": common.DirectAPIBaseURL(),
	})
}

func AddDirectIPAllowlist(c *gin.Context) {
	var req directIPAllowlistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "请求参数无效")
		return
	}
	entry, err := model.CreateDirectIPAllowlist(c.GetInt("id"), req.IP, req.Remark)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, entry)
}

func DeleteDirectIPAllowlist(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "无效的白名单 ID")
		return
	}
	err = model.DeleteDirectIPAllowlist(c.GetInt("id"), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorMsg(c, "未找到该 IPv4 白名单记录")
		} else {
			common.ApiError(c, err)
		}
		return
	}
	common.ApiSuccess(c, nil)
}

func GetAdminDirectIPAllowlists(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	var enabled *bool
	if raw := strings.TrimSpace(c.Query("enabled")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			common.ApiErrorMsg(c, "enabled 参数错误")
			return
		}
		enabled = &value
	}
	items, total, err := model.ListDirectIPAllowlists(model.DirectIPAllowlistFilter{
		Query: c.Query("query"), Enabled: enabled,
	}, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func UpdateAdminDirectIPAllowlist(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "白名单 ID 无效")
		return
	}
	var req directIPAllowlistAdminRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Enabled == nil {
		common.ApiErrorMsg(c, "缺少 enabled 参数")
		return
	}
	if err := model.SetDirectIPAllowlistEnabled(id, *req.Enabled); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id, "enabled": *req.Enabled})
}

func DeleteAdminDirectIPAllowlist(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "白名单 ID 无效")
		return
	}
	if err := model.DB.Delete(&model.DirectIPAllowlist{}, id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}

func GetDirectAPIConfig(c *gin.Context) {
	common.OptionMapRWMutex.RLock()
	hosts := common.OptionMap["DirectAPIHosts"]
	baseURL := common.OptionMap["DirectAPIBaseURL"]
	common.OptionMapRWMutex.RUnlock()
	common.ApiSuccess(c, gin.H{"hosts": hosts, "base_url": baseURL, "resolved_hosts": common.DirectAPIHosts(), "resolved_base_url": common.DirectAPIBaseURL()})
}

type directAPIConfigRequest struct {
	Hosts   string `json:"hosts"`
	BaseURL string `json:"base_url"`
}

func UpdateDirectAPIConfig(c *gin.Context) {
	var req directAPIConfigRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	hosts, err := common.NormalizeDirectAPIHostConfig(req.Hosts)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	baseURL := strings.TrimSpace(req.BaseURL)
	if err := common.ValidateDirectAPIBaseURL(baseURL); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.UpdateDirectAPIConfig(hosts, baseURL); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"hosts": hosts, "base_url": baseURL, "resolved_hosts": common.DirectAPIHosts(), "resolved_base_url": common.DirectAPIBaseURL()})
}
