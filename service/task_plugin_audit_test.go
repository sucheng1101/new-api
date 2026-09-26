package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const taskPluginAuditSource = `
export const meta = {
  apiVersion: 1,
  key: "audit-snapshot",
  name: "Audit Snapshot",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["audit-model"],
  fetchMode: "per_task",
};
export function buildSubmitRequest() { return {url: "https://provider.example/submit", method: "POST"}; }
export function parseSubmitResponse() { return {taskId: "provider-task"}; }
export function buildQueryRequest() { return {url: "https://provider.example/query", method: "GET"}; }
export function parseTaskResult() { return {status: "SUCCESS"}; }
`

func TestTaskExecutionSnapshotCapturesAllPinnedPluginForms(t *testing.T) {
	plugin, err := pluginruntime.CompilePlugin(taskPluginAuditSource, pluginruntime.Options{})
	require.NoError(t, err)

	tests := []struct {
		name       string
		generation uint64
		pin        func(*gin.Context)
	}{
		{
			name:       "legacy platform",
			generation: 11,
			pin: func(c *gin.Context) {
				c.Set(pluginruntime.ContextKeyPinnedPlugin, pluginruntime.PinnedPlugin{
					Plugin: plugin, Generation: &pluginruntime.RoutingGeneration{Number: 11},
				})
			},
		},
		{
			name:       "protocol endpoint",
			generation: 12,
			pin: func(c *gin.Context) {
				c.Set(pluginruntime.ContextKeyPinnedEndpoint, pluginruntime.PinnedEndpoint{
					Plugin: plugin, Generation: &pluginruntime.RoutingGeneration{Number: 12},
				})
			},
		},
		{
			name:       "declarative route",
			generation: 13,
			pin: func(c *gin.Context) {
				c.Set(pluginruntime.ContextKeyPinnedRoute, pluginruntime.PinnedRoute{
					Plugin: plugin, Generation: &pluginruntime.RoutingGeneration{Number: 13},
				})
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)
			common.SetContextKey(c, common.RequestIdKey, "request-"+testCase.name)
			testCase.pin(c)

			execution := TaskExecutionSnapshotFromContext(c)
			require.NotNil(t, execution)
			require.NotNil(t, execution.TaskPlugin)
			assert.Equal(t, plugin.Meta.Key, execution.TaskPlugin.Key)
			assert.Equal(t, plugin.Meta.Version, execution.TaskPlugin.Version)
			assert.Equal(t, plugin.SourceHash, execution.TaskPlugin.SourceHash)
			assert.Equal(t, testCase.generation, execution.TaskPlugin.Generation)
		})
	}
}
