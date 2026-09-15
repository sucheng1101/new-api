package model

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTaskPluginLogVisibilityIsRoleSeparated(t *testing.T) {
	other := common.MapToJsonStr(map[string]any{
		"model_price": 1.25,
		"admin_info": map[string]any{
			"task_plugin": map[string]any{
				"key":     "document-parser",
				"name":    "Document Parser",
				"version": "1.2.3",
			},
		},
		"root_info": map[string]any{
			"upstream_task_id": "upstream-private",
			"task_plugin": map[string]any{
				"generation": 42,
			},
		},
	})

	t.Run("user", func(t *testing.T) {
		logs := []*Log{{Other: other}}
		FormatUserLogs(logs, 0)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.NotContains(t, parsed, "admin_info")
		assert.NotContains(t, parsed, "root_info")
		assert.Equal(t, 1.25, parsed["model_price"])
	})

	t.Run("admin", func(t *testing.T) {
		logs := []*Log{{Other: other}}
		FormatAdminLogs(logs)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.Contains(t, parsed, "admin_info")
		assert.NotContains(t, parsed, "root_info")
	})

	t.Run("root", func(t *testing.T) {
		logs := []*Log{{Other: other}}
		FormatRootLogs(logs)

		parsed, err := common.StrToMap(logs[0].Other)
		require.NoError(t, err)
		assert.Contains(t, parsed, "admin_info")
		assert.Contains(t, parsed, "root_info")
	})
}

func TestFormatUserLogsStripsSensitiveScopes(t *testing.T) {
	other := common.MapToJsonStr(map[string]any{
		"request_path":  "/v1/videos",
		"channel_id":    202,
		"channel_name":  "private-channel",
		"channel_type":  61,
		"reject_reason": "private-rejection",
		"admin_info":    map[string]any{"task_plugin": "prompt-hubs"},
		"root_info":     map[string]any{"upstream_task_id": "upstream-private"},
		"audit_info":    map[string]any{"method": "POST"},
	})
	logs := []*Log{{Id: 99, ChannelName: "resolved-private-channel", Other: other}}

	FormatUserLogs(logs, 10)

	assert.Equal(t, 11, logs[0].Id)
	assert.Empty(t, logs[0].ChannelName)
	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	assert.Equal(t, "/v1/videos", parsed["request_path"])
	for _, key := range []string{
		"channel_id", "channel_name", "channel_type", "reject_reason",
		"admin_info", "root_info", "audit_info", "stream_status",
	} {
		assert.NotContains(t, parsed, key)
	}
}

func TestRelayLogsPersistAndFilterUpstreamRequestID(t *testing.T) {
	modelTestDBMutex.Lock()
	defer modelTestDBMutex.Unlock()

	previousLogDB := LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	LOG_DB = db
	t.Cleanup(func() {
		LOG_DB = previousLogDB
		_ = sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&Log{}))

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)
	c.Set("username", "log-test-user")
	c.Set(common.RequestIdKey, "gateway-request-id")
	c.Set(common.UpstreamRequestIdKey, "upstream-request-id")

	previousConsumeEnabled := common.LogConsumeEnabled
	common.LogConsumeEnabled = true
	t.Cleanup(func() {
		common.LogConsumeEnabled = previousConsumeEnabled
	})

	RecordConsumeLog(c, 101, RecordConsumeLogParams{
		ChannelId: 7,
		ModelName: "MiniMax-H3",
		TokenName: "test-token",
		Content:   "consume",
		TokenId:   9,
		Group:     "default",
		Other:     map[string]interface{}{},
	})
	RecordErrorLog(c, 101, 7, "MiniMax-H3", "test-token", "error", 9, 0, false, "default", map[string]interface{}{})

	logs, total, err := GetAllLogs(LogTypeUnknown, 0, 0, "", "", "", 0, 20, 0, "", "", "upstream-request-id")
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	require.Len(t, logs, 2)
	for _, log := range logs {
		assert.Equal(t, "gateway-request-id", log.RequestId)
		assert.Equal(t, "upstream-request-id", log.UpstreamRequestId)
	}
}
