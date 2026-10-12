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
