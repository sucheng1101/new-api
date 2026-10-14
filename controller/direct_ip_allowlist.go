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
		"endpoints":    common.EnabledDirectAPIEndpoints(),
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
	common.ApiSuccess(c, gin.H{"hosts": hosts, "base_url": baseURL, "endpoints": common.DirectAPIEndpoints(), "resolved_hosts": common.DirectAPIHosts(), "resolved_base_url": common.DirectAPIBaseURL()})
}

type directAPIConfigRequest struct {
	Hosts     *string                     `json:"hosts"`
	BaseURL   *string                     `json:"base_url"`
	Endpoints *[]common.DirectAPIEndpoint `json:"endpoints"`
}

type directAPIEndpointRequest struct {
	Name        string `json:"name"`
	Endpoint    string `json:"endpoint"`
	Description string `json:"description"`
	Enabled     *bool  `json:"enabled"`
	SortOrder   *int   `json:"sort_order"`
}

type directAPIEndpointPatchRequest struct {
	Name        *string `json:"name"`
	Endpoint    *string `json:"endpoint"`
	Description *string `json:"description"`
	Enabled     *bool   `json:"enabled"`
	SortOrder   *int    `json:"sort_order"`
}

func parseDirectAPIEndpointID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "endpoint ID 无效")
		return 0, false
	}
	return id, true
}

func upsertDirectAPIEndpoint(c *gin.Context, id int) {
	var req directAPIEndpointRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "endpoint 参数无效")
		return
	}
	endpoints := common.DirectAPIEndpoints()
	if id == 0 {
		item := common.DirectAPIEndpoint{Name: req.Name, Endpoint: req.Endpoint, Description: req.Description, Enabled: true}
		if req.Enabled != nil {
			item.Enabled = *req.Enabled
		}
		if req.SortOrder != nil {
			item.SortOrder = *req.SortOrder
		}
		endpoints = append(endpoints, item)
	} else {
		found := false
		for i := range endpoints {
			if endpoints[i].ID != id {
				continue
			}
			found = true
			endpoints[i].Name, endpoints[i].Endpoint, endpoints[i].Description = req.Name, req.Endpoint, req.Description
			if req.Enabled != nil {
				endpoints[i].Enabled = *req.Enabled
			}
			if req.SortOrder != nil {
				endpoints[i].SortOrder = *req.SortOrder
			}
			break
		}
		if !found {
			common.ApiErrorMsg(c, "未找到 endpoint")
			return
		}
	}
	validated, err := common.ValidateDirectAPIEndpoints(endpoints)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.UpdateDirectAPIEndpoints(validated); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if id == 0 && len(validated) > 0 {
		common.ApiSuccess(c, validated[len(validated)-1])
		return
	}
	for _, item := range validated {
		if item.ID == id {
			common.ApiSuccess(c, item)
			return
		}
	}
	common.ApiSuccess(c, nil)
}

func ListDirectAPIEndpoints(c *gin.Context)  { common.ApiSuccess(c, common.DirectAPIEndpoints()) }
func CreateDirectAPIEndpoint(c *gin.Context) { upsertDirectAPIEndpoint(c, 0) }
func UpdateDirectAPIEndpoint(c *gin.Context) {
	if id, ok := parseDirectAPIEndpointID(c); ok {
		upsertDirectAPIEndpoint(c, id)
	}
}

func PatchDirectAPIEndpoint(c *gin.Context) {
	id, ok := parseDirectAPIEndpointID(c)
	if !ok {
		return
	}
	var req directAPIEndpointPatchRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "endpoint 参数无效")
		return
	}
	endpoints := common.DirectAPIEndpoints()
	var updated *common.DirectAPIEndpoint
	for i := range endpoints {
		if endpoints[i].ID != id {
			continue
		}
		if req.Name != nil {
			endpoints[i].Name = *req.Name
		}
		if req.Endpoint != nil {
			endpoints[i].Endpoint = *req.Endpoint
		}
		if req.Description != nil {
			endpoints[i].Description = *req.Description
		}
		if req.Enabled != nil {
			endpoints[i].Enabled = *req.Enabled
		}
		if req.SortOrder != nil {
			endpoints[i].SortOrder = *req.SortOrder
		}
		copy := endpoints[i]
		updated = &copy
		break
	}
	if updated == nil {
		common.ApiErrorMsg(c, "未找到 endpoint")
		return
	}
	if err := model.UpdateDirectAPIEndpoints(endpoints); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	for _, item := range common.DirectAPIEndpoints() {
		if item.ID == id {
			common.ApiSuccess(c, item)
			return
		}
	}
	common.ApiSuccess(c, *updated)
}
func DeleteDirectAPIEndpoint(c *gin.Context) {
	id, ok := parseDirectAPIEndpointID(c)
	if !ok {
		return
	}
	endpoints := common.DirectAPIEndpoints()
	filtered := make([]common.DirectAPIEndpoint, 0, len(endpoints))
	found := false
	for _, item := range endpoints {
		if item.ID == id {
			found = true
			continue
		}
		filtered = append(filtered, item)
	}
	if !found {
		common.ApiErrorMsg(c, "未找到 endpoint")
		return
	}
	if err := model.UpdateDirectAPIEndpoints(filtered); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}

func UpdateDirectAPIConfig(c *gin.Context) {
	var req directAPIConfigRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	common.OptionMapRWMutex.RLock()
	hostsValue := common.OptionMap["DirectAPIHosts"]
	baseURLValue := common.OptionMap["DirectAPIBaseURL"]
	common.OptionMapRWMutex.RUnlock()
	if req.Hosts != nil {
		hostsValue = *req.Hosts
	}
	if req.BaseURL != nil {
		baseURLValue = *req.BaseURL
	}
	hosts, err := common.NormalizeDirectAPIHostConfig(hostsValue)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	baseURL := strings.TrimSpace(baseURLValue)
	if err := common.ValidateDirectAPIBaseURL(baseURL); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	var endpointArgs []common.DirectAPIEndpoint
	if req.Endpoints != nil {
		endpointArgs = *req.Endpoints
	}
	if req.Endpoints != nil {
		if err := model.UpdateDirectAPIConfig(hosts, baseURL, endpointArgs); err != nil {
			common.ApiError(c, err)
			return
		}
	} else if err := model.UpdateDirectAPIConfig(hosts, baseURL); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"hosts": hosts, "base_url": baseURL, "endpoints": common.DirectAPIEndpoints(), "resolved_hosts": common.DirectAPIHosts(), "resolved_base_url": common.DirectAPIBaseURL()})
}
