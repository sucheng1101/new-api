package common

import "strings"

// NormalizeEmailDomainWhitelist returns a stable, case-insensitive list of
// domain names for both validation and user-facing configuration display.
func NormalizeEmailDomainWhitelist(domains []string) []string {
	seen := make(map[string]struct{}, len(domains))
	result := make([]string, 0, len(domains))
	for _, value := range domains {
		domain := normalizeEmailDomain(value)
		if domain == "" {
			continue
		}
		if _, exists := seen[domain]; exists {
			continue
		}
		seen[domain] = struct{}{}
		result = append(result, domain)
	}
	return result
}

// IsEmailDomainAllowed compares domains case-insensitively and ignores
// surrounding whitespace so validation matches the runtime hint exactly.
func IsEmailDomainAllowed(domain string, whitelist []string) bool {
	normalized := normalizeEmailDomain(domain)
	if normalized == "" {
		return false
	}
	for _, allowed := range NormalizeEmailDomainWhitelist(whitelist) {
		if normalized == allowed {
			return true
		}
	}
	return false
}

func normalizeEmailDomain(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(value), "@")))
}
