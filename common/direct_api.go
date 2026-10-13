package common

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

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
