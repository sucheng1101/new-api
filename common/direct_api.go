package common

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
)

// DirectAPIEndpoint describes an additional OpenAI-compatible endpoint that
// can be exposed to users alongside the primary gateway address.
type DirectAPIEndpoint struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Endpoint    string `json:"endpoint"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	SortOrder   int    `json:"sort_order"`
}

// DirectAPIEndpoints returns the administrator-managed endpoint list. Invalid
// persisted JSON is treated as an empty list so a malformed optional setting
// cannot prevent the rest of the console from loading.
func DirectAPIEndpoints() []DirectAPIEndpoint {
	OptionMapRWMutex.RLock()
	raw := OptionMap["DirectAPIEndpoints"]
	OptionMapRWMutex.RUnlock()
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var endpoints []DirectAPIEndpoint
	if err := UnmarshalJsonStr(raw, &endpoints); err != nil || endpoints == nil {
		return nil
	}
	return endpoints
}

// EnabledDirectAPIEndpoints returns only endpoints currently visible to users.
func EnabledDirectAPIEndpoints() []DirectAPIEndpoint {
	endpoints := DirectAPIEndpoints()
	result := make([]DirectAPIEndpoint, 0, len(endpoints))
	for _, endpoint := range endpoints {
		if endpoint.Enabled {
			result = append(result, endpoint)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].SortOrder == result[j].SortOrder {
			return result[i].ID < result[j].ID
		}
		return result[i].SortOrder < result[j].SortOrder
	})
	return result
}

// NormalizeDirectAPIEndpoint validates and canonicalizes an endpoint URL.
// The URL must be absolute HTTP(S), must not contain credentials, query
// parameters, or fragments, and is normalized without a trailing slash.
func NormalizeDirectAPIEndpoint(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("API endpoint is required")
	}
	if err := ValidateDirectAPIBaseURL(raw); err != nil {
		return "", err
	}
	parsed, _ := url.Parse(raw)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return strings.TrimRight(parsed.String(), "/"), nil
}

// ValidateDirectAPIEndpoints validates and normalizes a complete endpoint
// collection, assigning IDs when a new item has no ID and preserving stable
// IDs for updates.
func ValidateDirectAPIEndpoints(input []DirectAPIEndpoint) ([]DirectAPIEndpoint, error) {
	result := make([]DirectAPIEndpoint, 0, len(input))
	seenIDs := make(map[int]struct{}, len(input))
	seenEndpoints := make(map[string]struct{}, len(input))
	nextID := 1
	for _, item := range input {
		item.Name = strings.TrimSpace(item.Name)
		item.Description = strings.TrimSpace(item.Description)
		if item.Name == "" {
			return nil, fmt.Errorf("direct API endpoint name is required")
		}
		if len(item.Name) > 100 || len(item.Description) > 500 {
			return nil, fmt.Errorf("direct API endpoint name or description is too long")
		}
		endpoint, err := NormalizeDirectAPIEndpoint(item.Endpoint)
		if err != nil {
			return nil, fmt.Errorf("invalid direct API endpoint %q: %w", item.Endpoint, err)
		}
		item.Endpoint = endpoint
		if item.ID <= 0 {
			for {
				if _, exists := seenIDs[nextID]; !exists {
					item.ID = nextID
					nextID++
					break
				}
				nextID++
			}
		}
		if _, exists := seenIDs[item.ID]; exists {
			return nil, fmt.Errorf("duplicate direct API endpoint id: %d", item.ID)
		}
		if _, exists := seenEndpoints[strings.ToLower(item.Endpoint)]; exists {
			return nil, fmt.Errorf("duplicate direct API endpoint URL: %s", item.Endpoint)
		}
		seenIDs[item.ID] = struct{}{}
		seenEndpoints[strings.ToLower(item.Endpoint)] = struct{}{}
		if item.SortOrder < 0 {
			return nil, fmt.Errorf("direct API endpoint sort_order must be non-negative")
		}
		result = append(result, item)
	}
	return result, nil
}

// DirectAPIHosts returns the host names that are served by the DNS-only direct
// API entry point. DIRECT_API_HOST accepts a comma-separated list and may also
// contain a URL for convenience.
func DirectAPIHosts() []string {
	raw := directAPIConfigValue("DirectAPIHosts", "DIRECT_API_HOST")
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
	if configured := strings.TrimRight(directAPIConfigValue("DirectAPIBaseURL", "DIRECT_API_BASE_URL"), "/"); configured != "" {
		return configured
	}
	hosts := DirectAPIHosts()
	if len(hosts) == 1 {
		return "https://" + hosts[0]
	}
	return ""
}

// NormalizeDirectAPIHostConfig validates and canonicalizes the administrator-
// managed list of DNS hostnames. Scheme-qualified values remain accepted for
// compatibility with DIRECT_API_HOST, but only their hostname is persisted.
func NormalizeDirectAPIHostConfig(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}

	hosts := make([]string, 0)
	seen := make(map[string]struct{})
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			return "", fmt.Errorf("direct API host list contains an empty entry")
		}

		candidate := item
		if strings.Contains(candidate, "://") {
			parsed, err := url.Parse(candidate)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
				return "", fmt.Errorf("invalid direct API host: %q", item)
			}
			if err := validateDirectAPIPort(parsed.Port()); err != nil {
				return "", fmt.Errorf("invalid direct API host: %q", item)
			}
			candidate = parsed.Host
		} else {
			if strings.ContainsAny(candidate, "/?#") {
				return "", fmt.Errorf("invalid direct API host: %q", item)
			}
			if strings.Contains(candidate, ":") {
				_, port, err := net.SplitHostPort(candidate)
				if err != nil {
					return "", fmt.Errorf("invalid direct API host: %q", item)
				}
				if err := validateDirectAPIPort(port); err != nil {
					return "", fmt.Errorf("invalid direct API host: %q", item)
				}
			}
		}

		host := normalizeDirectAPIHost(candidate)
		if !isDirectAPIHostname(host, false) {
			return "", fmt.Errorf("direct API host must be a valid domain name: %q", item)
		}
		if _, ok := seen[host]; ok {
			continue
		}
		seen[host] = struct{}{}
		hosts = append(hosts, host)
	}
	return strings.Join(hosts, ","), nil
}

// ValidateDirectAPIBaseURL ensures the value exposed to users is an absolute
// HTTP(S) URL without credentials, query parameters, or fragments.
func ValidateDirectAPIBaseURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("API address must be an absolute HTTP(S) URL without credentials, query, or fragment")
	}
	if parsed.Hostname() == "" || validateDirectAPIPort(parsed.Port()) != nil || !isDirectAPIHostname(parsed.Hostname(), true) {
		return fmt.Errorf("API address contains an invalid host or port")
	}
	return nil
}

func validateDirectAPIPort(port string) error {
	if port == "" {
		return nil
	}
	value, err := strconv.Atoi(port)
	if err != nil || value < 1 || value > 65535 {
		return fmt.Errorf("invalid port")
	}
	return nil
}

func isDirectAPIHostname(host string, allowSingleLabel bool) bool {
	if host == "" || len(host) > 253 {
		return false
	}
	if net.ParseIP(host) != nil {
		return allowSingleLabel
	}
	labels := strings.Split(host, ".")
	if !allowSingleLabel && len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') && !(char >= '0' && char <= '9') && char != '-' {
				return false
			}
		}
	}
	return true
}

// directAPIConfigValue prefers the persisted administrator setting. The
// configured marker lets an administrator intentionally clear an environment
// default without having it reappear after a process restart.
func directAPIConfigValue(key, envKey string) string {
	OptionMapRWMutex.RLock()
	value, hasValue := OptionMap[key]
	configured := OptionMap[key+"Configured"] == "true"
	OptionMapRWMutex.RUnlock()
	if configured || (hasValue && strings.TrimSpace(value) != "") {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(os.Getenv(envKey))
}
