package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestLookupIPGeoClassifiesLocalAndPrivateAddresses(t *testing.T) {
	tests := []struct {
		name    string
		address string
		status  string
		country string
	}{
		{name: "loopback", address: "127.0.0.1", status: "local", country: "本机地址"},
		{name: "ipv6 loopback", address: "::1", status: "local", country: "本机地址"},
		{name: "private", address: "192.168.1.10", status: "private", country: "内网地址"},
		{name: "invalid", address: "not-an-ip", status: "invalid", country: "无效 IP"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := LookupIPGeo(context.Background(), test.address)
			if got.Status != test.status || got.Country != test.country {
				t.Fatalf("LookupIPGeo(%q) = %#v, want status=%q country=%q", test.address, got, test.status, test.country)
			}
		})
	}
}

func TestLookupIPGeoCachesResolvedAddress(t *testing.T) {
	var requests atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"country":"Testland","region":"Test Region","city":"Test City","connection":{"isp":"Test ISP","asn":64500},"timezone":{"id":"UTC"}}`))
	}))
	defer provider.Close()

	t.Setenv("IP_GEO_ENDPOINT", provider.URL)
	address := "203.0.113.10"
	first := LookupIPGeo(context.Background(), address)
	second := LookupIPGeo(context.Background(), address)

	if first.Status != "resolved" || second.Status != "resolved" {
		t.Fatalf("expected resolved results, got first=%#v second=%#v", first, second)
	}
	if first.Country != "Testland" || first.ASN != "AS64500" || first.Timezone != "UTC" {
		t.Fatalf("unexpected resolved data: %#v", first)
	}
	if requests.Load() != 1 {
		t.Fatalf("expected one provider request due to cache, got %d", requests.Load())
	}
}
