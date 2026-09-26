package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func disableTaskMediaSSRFForTest(t *testing.T) {
	t.Helper()
	setting := system_setting.GetFetchSetting()
	previous := *setting
	*setting = system_setting.FetchSetting{EnableSSRFProtection: false}
	t.Cleanup(func() { *setting = previous })
}

func TestTaskMediaRedirectClientDropsCredentialsOnlyWhenExplicitlyAllowed(t *testing.T) {
	disableTaskMediaSSRFForTest(t)
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodGet, "https://gateway.example/v1/tasks/task/artifacts/video/content", nil)
	previous := httptest.NewRequest(http.MethodGet, "https://console.prompt-hubs.example/v1/videos/upstream/content", nil)
	clientHeaders := map[string]string{"Range": "bytes=0-1023", "If-Range": "etag"}

	t.Run("default rejects credentialed cross-origin redirect", func(t *testing.T) {
		next := httptest.NewRequest(http.MethodGet, "https://media.example/video.mp4", nil)
		next.Header.Set("Authorization", "Bearer provider-key")
		client := taskMediaRedirectClient(&http.Client{}, "", context, clientHeaders, false, false)
		err := client.CheckRedirect(next, []*http.Request{previous})
		require.Error(t, err)
		assert.True(t, errors.Is(err, errTaskMediaRequestRejected))
	})

	t.Run("explicit permission strips sensitive headers and preserves media headers", func(t *testing.T) {
		next := httptest.NewRequest(http.MethodGet, "https://media.example/video.mp4", nil)
		next.Header.Set("Authorization", "Bearer provider-key")
		next.Header.Set("X-Plugin-Secret", "do-not-forward")
		client := taskMediaRedirectClient(&http.Client{}, "", context, clientHeaders, false, true)
		require.NoError(t, client.CheckRedirect(next, []*http.Request{previous}))
		assert.Empty(t, next.Header.Get("Authorization"))
		assert.Empty(t, next.Header.Get("X-Plugin-Secret"))
		assert.Equal(t, "bytes=0-1023", next.Header.Get("Range"))
		assert.Equal(t, "etag", next.Header.Get("If-Range"))
	})
}

func TestTaskArtifactAPIKeyUsesCurrentChannelKeyForTaskPlugin(t *testing.T) {
	channel := &model.Channel{Type: constant.ChannelTypeTaskPlugin, Key: "channel-key"}
	legacyTask := &model.Task{PrivateData: model.TaskPrivateData{Key: "legacy-task-key"}}
	assert.Equal(t, "channel-key", taskArtifactAPIKey(legacyTask, channel))

	geminiChannel := &model.Channel{Type: constant.ChannelTypeGemini, Key: "current-channel-key"}
	assert.Equal(t, "legacy-task-key", taskArtifactAPIKey(legacyTask, geminiChannel))
}
