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

// Record kinds stored in the unified DirectAPIEndpoints collection. Legacy
// records without a kind are treated as OpenAI-compatible endpoints, which
// keeps previously persisted JSON fully backward compatible.
const (
	DirectAPIRecordKindHost     = "host"
	DirectAPIRecordKindBaseURL  = "base_url"
	DirectAPIRecordKindEndpoint = "endpoint"
)

// DirectAPIRecordsMigratedOption marks that the legacy DirectAPIHosts and
// DirectAPIBaseURL settings have been folded into the unified record list.
const DirectAPIRecordsMigratedOption = "DirectAPIRecordsMigrated"

// DirectAPIEndpoint describes a single administrator-managed domain record.
// A record may be a DNS host (kind=host), the public base URL (kind=base_url),
// or an additional OpenAI-compatible endpoint (kind=endpoint). The zero value
// kind is interpreted as an endpoint for backward compatibility.
type DirectAPIEndpoint struct {
	ID          int    `json:"id"`
	Kind        string `json:"kind,omitempty"`
	Name        string `json:"name"`
	Endpoint    string `json:"endpoint"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	SortOrder   int    `json:"sort_order"`
	UpdatedAt   int64  `json:"updated_at,omitempty"`
}

// DirectAPIRecordKind normalizes a record kind. Unknown kinds are returned
// lower-cased so validation can reject them explicitly.
func DirectAPIRecordKind(item DirectAPIEndpoint) string {
	switch kind := strings.ToLower(strings.TrimSpace(item.Kind)); kind {
	case DirectAPIRecordKindHost:
		return DirectAPIRecordKindHost
	case DirectAPIRecordKindBaseURL:
		return DirectAPIRecordKindBaseURL
	case "", DirectAPIRecordKindEndpoint:
		return DirectAPIRecordKindEndpoint
	default:
		return kind
	}
}

// DirectAPIEndpoints returns the administrator-managed unified record list.
// Invalid persisted JSON is treated as an empty list so a malformed optional
// setting cannot prevent the rest of the console from loading.
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

// directAPIRecordsMigrated reports whether the unified record list became the
// authoritative source for direct hosts and the public base URL.
func directAPIRecordsMigrated() bool {
	OptionMapRWMutex.RLock()
	migrated := OptionMap[DirectAPIRecordsMigratedOption] == "true"
	OptionMapRWMutex.RUnlock()
	return migrated
}

// EnabledDirectAPIEndpoints returns only OpenAI-compatible endpoint records
// currently visible to users. Host and base URL records are excluded because
// they are not additional endpoints.
func EnabledDirectAPIEndpoints() []DirectAPIEndpoint {
	endpoints := DirectAPIEndpoints()
	result := make([]DirectAPIEndpoint, 0, len(endpoints))
	for _, endpoint := range endpoints {
		if DirectAPIRecordKind(endpoint) != DirectAPIRecordKindEndpoint {
			continue
		}
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

// ValidateDirectAPIEndpoints validates and normalizes a complete unified
// domain record collection, assigning IDs when a new item has no ID and
// preserving stable IDs for updates. Each record kind has its own validation
// rules so hosts, the public base URL, and OpenAI-compatible endpoints can
// coexist in one list.
func ValidateDirectAPIEndpoints(input []DirectAPIEndpoint) ([]DirectAPIEndpoint, error) {
	result := make([]DirectAPIEndpoint, 0, len(input))
	seenIDs := make(map[int]struct{}, len(input))
	seenValues := make(map[string]struct{}, len(input))
	nextID := 1
	baseURLCount := 0
	now := GetTimestamp()
	for _, item := range input {
		kind := DirectAPIRecordKind(item)
		item.Kind = kind
		item.Name = strings.TrimSpace(item.Name)
		item.Description = strings.TrimSpace(item.Description)
		switch kind {
		case DirectAPIRecordKindHost:
			hostConfig, err := NormalizeDirectAPIHostConfig(item.Endpoint)
			if err != nil {
				return nil, err
			}
			if hostConfig == "" || strings.Contains(hostConfig, ",") {
				return nil, fmt.Errorf("direct API host record must contain exactly one host")
			}
			item.Endpoint = hostConfig
			if item.Name == "" {
				item.Name = hostConfig
			}
			if _, exists := seenValues["host:"+hostConfig]; exists {
				return nil, fmt.Errorf("duplicate direct API host: %s", hostConfig)
			}
			seenValues["host:"+hostConfig] = struct{}{}
		case DirectAPIRecordKindBaseURL:
			value := strings.TrimSpace(item.Endpoint)
			if value == "" {
				return nil, fmt.Errorf("direct API base URL is required")
			}
			if err := ValidateDirectAPIBaseURL(value); err != nil {
				return nil, err
			}
			item.Endpoint = strings.TrimRight(value, "/")
			if item.Name == "" {
				item.Name = item.Endpoint
			}
			baseURLCount++
			if baseURLCount > 1 {
				return nil, fmt.Errorf("only one direct API base URL record is allowed")
			}
		case DirectAPIRecordKindEndpoint:
			if item.Name == "" {
				return nil, fmt.Errorf("direct API endpoint name is required")
			}
			endpoint, err := NormalizeDirectAPIEndpoint(item.Endpoint)
			if err != nil {
				return nil, fmt.Errorf("invalid direct API endpoint %q: %w", item.Endpoint, err)
			}
			item.Endpoint = endpoint
			if _, exists := seenValues["endpoint:"+strings.ToLower(endpoint)]; exists {
				return nil, fmt.Errorf("duplicate direct API endpoint URL: %s", endpoint)
			}
			seenValues["endpoint:"+strings.ToLower(endpoint)] = struct{}{}
		default:
			return nil, fmt.Errorf("unsupported direct API record kind: %s", kind)
		}
		if len(item.Name) > 100 || len(item.Description) > 500 {
			return nil, fmt.Errorf("direct API record name or description is too long")
		}
		if item.SortOrder < 0 {
			return nil, fmt.Errorf("direct API record sort_order must be non-negative")
		}
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
			return nil, fmt.Errorf("duplicate direct API record id: %d", item.ID)
		}
		seenIDs[item.ID] = struct{}{}
		if item.UpdatedAt <= 0 {
			item.UpdatedAt = now
		}
		result = append(result, item)
	}
	return result, nil
}

// DirectAPIHosts returns the host names that are served by the DNS-only direct
// API entry point. Once the unified record list is authoritative, only enabled
// host records contribute; before migration, DIRECT_API_HOST is read as a
// comma-separated list that may also contain a URL for convenience.
func DirectAPIHosts() []string {
	if !directAPIRecordsMigrated() {
		return legacyDirectAPIHosts()
	}
	hosts := make([]string, 0)
	seen := make(map[string]struct{})
	for _, record := range DirectAPIEndpoints() {
		if DirectAPIRecordKind(record) != DirectAPIRecordKindHost || !record.Enabled {
			continue
		}
		host := normalizeDirectAPIHost(record.Endpoint)
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

// legacyDirectAPIHosts reads the pre-migration DirectAPIHosts setting and the
// DIRECT_API_HOST environment variable.
func legacyDirectAPIHosts() []string {
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
// URL. Once the unified record list is authoritative, the enabled base URL
// record wins; an explicitly disabled base URL record suppresses any fallback.
func DirectAPIBaseURL() string {
	if directAPIRecordsMigrated() {
		for _, record := range DirectAPIEndpoints() {
			if DirectAPIRecordKind(record) != DirectAPIRecordKindBaseURL {
				continue
			}
			if record.Enabled {
				return strings.TrimRight(strings.TrimSpace(record.Endpoint), "/")
			}
			return ""
		}
		return ""
	}
	return legacyDirectAPIBaseURL()
}

// legacyDirectAPIBaseURL derives the public base URL from the pre-migration
// DIRECT_API_BASE_URL setting or a single configured host.
func legacyDirectAPIBaseURL() string {
	if configured := ConfiguredDirectAPIBaseURL(); configured != "" {
		return configured
	}
	hosts := DirectAPIHosts()
	if len(hosts) == 1 {
		return "https://" + hosts[0]
	}
	return ""
}

// ConfiguredDirectAPIBaseURL returns only the explicitly configured
// DIRECT_API_BASE_URL value, without deriving it from configured hosts. It is
// used when migrating legacy settings into the unified record list.
func ConfiguredDirectAPIBaseURL() string {
	return strings.TrimRight(strings.TrimSpace(directAPIConfigValue("DirectAPIBaseURL", "DIRECT_API_BASE_URL")), "/")
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
