package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/gin-gonic/gin"
)

// validateRegistrationEmailDomain snapshots the runtime policy for both the
// verification-code and registration endpoints.
func validateRegistrationEmailDomain(c *gin.Context, domain string) bool {
	common.OptionMapRWMutex.RLock()
	enabled := common.EmailDomainRestrictionEnabled
	whitelist := common.NormalizeEmailDomainWhitelist(common.EmailDomainWhitelist)
	common.OptionMapRWMutex.RUnlock()
	if !enabled || common.IsEmailDomainAllowed(domain, whitelist) {
		return true
	}
	if len(whitelist) == 0 {
		common.ApiErrorI18n(c, i18n.MsgUserEmailRegistrationClosed)
	} else if len(whitelist) == 1 && whitelist[0] == "qq.com" {
		common.ApiErrorI18n(c, i18n.MsgUserEmailQQOnly)
	} else {
		domains := make([]string, len(whitelist))
		for index, value := range whitelist {
			domains[index] = "@" + value
		}
		common.ApiErrorI18n(c, i18n.MsgUserEmailDomainRestricted, map[string]any{"Domains": strings.Join(domains, ", ")})
	}
	return false
}
