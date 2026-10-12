package common

import (
	"net"
	"net/url"
	"os"
	"strings"
)

// DirectAPIHosts returns the host names that are served by the DNS-only direct
// API entry point. DIRECT_API_HOST accepts a comma-separated list and may also
// contain a URL for convenience.
func DirectAPIHosts() []string {
	raw := strings.TrimSpace(os.Getenv("DIRECT_API_HOST"))
	if raw == "" {
		return nil
	}

	hosts := make([]string, 0)
	seen := make(map[string]struct{})
	for _, item := range strings.Split(raw, ",") {
		host := normalizeDirectAPIHost(item)
		if host == "" {
			continue
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		hosts = append(hosts, host)
	}
	return hosts
}

func normalizeDirectAPIHost(raw string) string {
	raw = strings.TrimSpace(strings.TrimSuffix(raw, "."))
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "://") {
		parsed, err := url.Parse(raw)
		if err != nil {
			return ""
		}
		raw = parsed.Host
	}
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	} else if strings.HasPrefix(raw, "[") && strings.HasSuffix(raw, "]") {
		raw = strings.Trim(raw, "[]")
	}
	return strings.ToLower(strings.TrimSpace(strings.TrimSuffix(raw, ".")))
}

// IsDirectAPIRequest reports whether requestHost is one of the explicitly
// configured direct API hosts. An empty configuration leaves direct mode off.
func IsDirectAPIRequest(requestHost string) bool {
	host := normalizeDirectAPIHost(requestHost)
	if host == "" {
		return false
	}
	for _, configured := range DirectAPIHosts() {
		if host == configured {
			return true
		}
	}
	return false
}

// DirectAPIBaseURL is exposed to the account settings UI as a copyable base
// URL. DIRECT_API_BASE_URL takes precedence over the host-derived HTTPS URL.
func DirectAPIBaseURL() string {
	if configured := strings.TrimRight(strings.TrimSpace(os.Getenv("DIRECT_API_BASE_URL")), "/"); configured != "" {
		return configured
	}
	hosts := DirectAPIHosts()
	if len(hosts) == 1 {
		return "https://" + hosts[0]
	}
	return ""
}
