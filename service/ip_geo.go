package service

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type IPGeo struct {
	Status   string `json:"status"`
	Country  string `json:"country"`
	Region   string `json:"region"`
	City     string `json:"city"`
	ISP      string `json:"isp"`
	ASN      string `json:"asn"`
	Timezone string `json:"timezone"`
}

type ipGeoProviderResponse struct {
	Success  bool   `json:"success"`
	Country  string `json:"country"`
	Region   string `json:"region"`
	City     string `json:"city"`
	ISP      string `json:"connection_org"`
	ASN      string `json:"connection_asn"`
	Timezone string `json:"timezone_id"`
}

type ipGeoCacheEntry struct {
	value IPGeo
	at    time.Time
}

var ipGeoCache = struct {
	sync.RWMutex
	items map[string]ipGeoCacheEntry
}{items: make(map[string]ipGeoCacheEntry)}

func LookupIPGeo(ctx context.Context, address string) IPGeo {
	ip := net.ParseIP(strings.TrimSpace(address))
	if ip == nil {
		return IPGeo{Status: "invalid", Country: "无效 IP"}
	}
	if ip.IsLoopback() {
		return IPGeo{Status: "local", Country: "本机地址"}
	}
	if ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return IPGeo{Status: "private", Country: "内网地址"}
	}
	key := ip.String()
	ipGeoCache.RLock()
	entry, ok := ipGeoCache.items[key]
	ipGeoCache.RUnlock()
	if ok && time.Since(entry.at) < 24*time.Hour {
		return entry.value
	}
	base := common.GetEnvOrDefaultString("IP_GEO_ENDPOINT", "https://ipwho.is")
	requestCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, strings.TrimRight(base, "/")+"/"+url.PathEscape(key), nil)
	if err != nil {
		return IPGeo{Status: "error", Country: "查询失败"}
	}
	req.Header.Set("User-Agent", "new-api-ip-geo")
	resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	if err != nil {
		return IPGeo{Status: "error", Country: "查询失败"}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return IPGeo{Status: "error", Country: fmt.Sprintf("查询失败（HTTP %d）", resp.StatusCode)}
	}
	var payload ipGeoProviderResponse
	if err := common.DecodeJson(resp.Body, &payload); err != nil || !payload.Success {
		return IPGeo{Status: "error", Country: "暂无归属地"}
	}
	value := IPGeo{Status: "resolved", Country: payload.Country, Region: payload.Region, City: payload.City, ISP: payload.ISP, ASN: payload.ASN, Timezone: payload.Timezone}
	ipGeoCache.Lock()
	ipGeoCache.items[key] = ipGeoCacheEntry{value: value, at: time.Now()}
	ipGeoCache.Unlock()
	return value
}
