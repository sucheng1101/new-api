package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func setRegistrationEmailPolicy(t *testing.T, enabled bool, domains []string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	oldEnabled, oldDomains := common.EmailDomainRestrictionEnabled, common.EmailDomainWhitelist
	common.EmailDomainRestrictionEnabled, common.EmailDomainWhitelist = enabled, domains
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.EmailDomainRestrictionEnabled, common.EmailDomainWhitelist = oldEnabled, oldDomains
		common.OptionMapRWMutex.Unlock()
	})
}

func TestRegistrationEmailPolicy(t *testing.T) {
	for _, tc := range []struct {
		name    string
		enabled bool
		domains []string
		domain  string
		allowed bool
		message string
	}{
		{"QQ allowed", true, []string{" QQ.COM ", "@qq.com"}, "QQ.COM", true, ""},
		{"QQ only", true, []string{" QQ.COM ", "@qq.com"}, "gmail.com", false, "当前仅支持 QQ 邮箱（@qq.com）注册，请使用 QQ 邮箱接收验证码。"},
		{"multiple allowed", true, []string{"qq.com", "gmail.com"}, "gmail.com", true, ""},
		{"multiple denied", true, []string{"@qq.com", " GMAIL.COM "}, "outlook.com", false, "当前仅支持以下邮箱域名注册：@qq.com, @gmail.com，请使用对应邮箱接收验证码。"},
		{"restriction disabled", false, []string{"qq.com"}, "outlook.com", true, ""},
		{"empty whitelist", true, []string{"", " @ "}, "qq.com", false, "当前暂未开放邮箱注册，请联系管理员。"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setRegistrationEmailPolicy(t, tc.enabled, tc.domains)
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/", nil)
			ctx.Request.Header.Set("Accept-Language", "zh-CN")
			require.Equal(t, tc.allowed, validateRegistrationEmailDomain(ctx, tc.domain))
			if !tc.allowed {
				response := decodeChannelI18nResponse(t, recorder)
				require.Equal(t, false, response["success"])
				require.Equal(t, tc.message, response["message"])
			}
		})
	}
}

func TestRegistrationEmailPolicyLocalization(t *testing.T) {
	setRegistrationEmailPolicy(t, true, []string{"qq.com"})
	for language, expected := range map[string]string{
		"zh-CN": "当前仅支持 QQ 邮箱（@qq.com）注册，请使用 QQ 邮箱接收验证码。",
		"zh-TW": "目前僅支援 QQ 信箱（@qq.com）註冊，請使用 QQ 信箱接收驗證碼。",
		"en":    "Registration currently supports QQ email addresses (@qq.com) only. Please use a QQ email address to receive the verification code.",
	} {
		recorder := performChannelI18nRequest(t, http.MethodGet, "/api/verification?email=fixture%40gmail.com", language, nil, SendEmailVerification)
		require.Equal(t, expected, decodeChannelI18nResponse(t, recorder)["message"])
	}
}

func TestStatusExposesNormalizedRegistrationEmailPolicy(t *testing.T) {
	setRegistrationEmailPolicy(t, true, []string{" QQ.COM ", "@gmail.com", "qq.com", ""})
	recorder := performChannelI18nRequest(t, http.MethodGet, "/api/status", "zh-CN", nil, GetStatus)
	response := decodeChannelI18nResponse(t, recorder)
	require.Equal(t, true, response["success"])
	data := response["data"].(map[string]any)
	require.Equal(t, true, data["email_domain_restriction_enabled"])
	require.Equal(t, []any{"qq.com", "gmail.com"}, data["email_domain_whitelist"])
}

func TestRegistrationRechecksPolicyAfterVerificationCodeIssued(t *testing.T) {
	oldRegister, oldPassword, oldEmail := common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled
	common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled = true, true, true
	t.Cleanup(func() {
		common.RegisterEnabled, common.PasswordRegisterEnabled, common.EmailVerificationEnabled = oldRegister, oldPassword, oldEmail
	})
	setRegistrationEmailPolicy(t, true, []string{"qq.com", "gmail.com"})
	email, code := "fixture@gmail.com", "123456"
	common.RegisterVerificationCodeWithKey(email, code, common.EmailVerificationPurpose)
	t.Cleanup(func() { common.DeleteKey(email, common.EmailVerificationPurpose) })
	require.True(t, common.VerifyCodeWithKey(email, code, common.EmailVerificationPurpose))

	// The administrator changes the policy after this code was issued.
	common.OptionMapRWMutex.Lock()
	common.EmailDomainWhitelist = []string{"qq.com"}
	common.OptionMapRWMutex.Unlock()
	body, err := common.Marshal(model.User{Username: "email_fixture", Password: "fixture123", Email: email, VerificationCode: code})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/register", bytes.NewReader(body))
	ctx.Request.Header.Set("Accept-Language", "zh-CN")
	Register(ctx)
	registration := decodeChannelI18nResponse(t, recorder)
	require.Equal(t, false, registration["success"])

	verification := performChannelI18nRequest(t, http.MethodGet, "/api/verification?email="+url.QueryEscape(email), "zh-CN", nil, SendEmailVerification)
	verificationResponse := decodeChannelI18nResponse(t, verification)
	require.Equal(t, false, verificationResponse["success"])
	require.Equal(t, "当前仅支持 QQ 邮箱（@qq.com）注册，请使用 QQ 邮箱接收验证码。", registration["message"])
	require.Equal(t, verificationResponse["message"], registration["message"])
}
