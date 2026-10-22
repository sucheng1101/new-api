package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupDirectIPAllowlistMiddlewareTest(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.DirectIPAllowlist{}))
	model.DB = database
	t.Cleanup(func() { model.DB = previousDB })
	gin.SetMode(gin.TestMode)
}

func directIPAllowlistTestContext(host, remoteAddr string) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "https://"+host+"/v1/models", nil)
	context.Request.Host = host
	context.Request.RemoteAddr = remoteAddr
	return context, recorder
}

func TestEnforceDirectIPAllowlist(t *testing.T) {
	setupDirectIPAllowlistMiddlewareTest(t)
	t.Setenv("DIRECT_API_HOST", "gw.example.com")

	entry, err := model.CreateDirectIPAllowlist(42, "203.0.113.10", "gateway")
	require.NoError(t, err)
	assert.NotZero(t, entry.Id)

	allowedContext, allowedRecorder := directIPAllowlistTestContext("gw.example.com", "203.0.113.10:4321")
	assert.True(t, enforceDirectIPAllowlist(allowedContext, 42))
	assert.Equal(t, http.StatusOK, allowedRecorder.Code)

	deniedContext, deniedRecorder := directIPAllowlistTestContext("gw.example.com", "203.0.113.11:4321")
	assert.False(t, enforceDirectIPAllowlist(deniedContext, 42))
	assert.Equal(t, http.StatusForbidden, deniedRecorder.Code)

	nonDirectContext, nonDirectRecorder := directIPAllowlistTestContext("api.example.com", "203.0.113.11:4321")
	assert.True(t, enforceDirectIPAllowlist(nonDirectContext, 42))
	assert.Equal(t, http.StatusOK, nonDirectRecorder.Code)
}

func TestEnforceDirectIPAllowlistRejectsIPv6(t *testing.T) {
	setupDirectIPAllowlistMiddlewareTest(t)
	t.Setenv("DIRECT_API_HOST", "gw.example.com")
	context, recorder := directIPAllowlistTestContext("gw.example.com", "[2001:db8::10]:4321")
	assert.False(t, enforceDirectIPAllowlist(context, 42))
	assert.Equal(t, http.StatusForbidden, recorder.Code)
}

func TestEnforceDirectIPAllowlistDeniesEmptyListOnDirectHost(t *testing.T) {
	setupDirectIPAllowlistMiddlewareTest(t)
	t.Setenv("DIRECT_API_HOST", "gw.example.com")
	context, recorder := directIPAllowlistTestContext("gw.example.com", "203.0.113.10:4321")

	assert.False(t, enforceDirectIPAllowlist(context, 42))
	assert.Equal(t, http.StatusForbidden, recorder.Code)
}
