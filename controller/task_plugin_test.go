package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

var taskPluginControllerTestMutex sync.Mutex

func temporaryTaskPluginSource(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "testdata", "task-plugins", "temporary-host-acceptance", "plugin.js")
	source, err := os.ReadFile(path)
	require.NoError(t, err)
	return string(source)
}

func setupTaskPluginControllerTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousUsingSQLite := common.UsingSQLite
	previousUsingMySQL := common.UsingMySQL
	previousUsingPostgreSQL := common.UsingPostgreSQL
	previousMemoryCache := common.MemoryCacheEnabled
	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false
	common.MemoryCacheEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	database, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = database, database
	require.NoError(t, database.AutoMigrate(&model.TaskPlugin{}, &model.Channel{}, &model.Task{}))

	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.UsingSQLite = previousUsingSQLite
		common.UsingMySQL = previousUsingMySQL
		common.UsingPostgreSQL = previousUsingPostgreSQL
		common.MemoryCacheEnabled = previousMemoryCache
		if sqlDB, closeErr := database.DB(); closeErr == nil {
			_ = sqlDB.Close()
		}
	})
	return database
}

func taskPluginJSONContext(t *testing.T, method, path, body string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, path, bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c, recorder
}

func taskPluginParamContext(t *testing.T, method, path, key, version, body string) (*gin.Context, *httptest.ResponseRecorder) {
	c, recorder := taskPluginJSONContext(t, method, path, body)
	params := gin.Params{{Key: "key", Value: key}}
	if version != "" {
		params = append(params, gin.Param{Key: "version", Value: version})
	}
	c.Params = params
	return c, recorder
}

func decodeTaskPluginResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var response map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func TestTaskPluginHostManagementLifecycle(t *testing.T) {
	taskPluginControllerTestMutex.Lock()
	defer taskPluginControllerTestMutex.Unlock()
	database := setupTaskPluginControllerTestDB(t)

	previousOverrides := jsplugin.DefaultRegistry.OverridePlugins()
	t.Cleanup(func() {
		restored := make([]*jsplugin.LoadedPlugin, 0, len(previousOverrides))
		for _, plugin := range previousOverrides {
			restored = append(restored, plugin)
		}
		require.NoError(t, jsplugin.DefaultRegistry.ReplaceOverrides(restored))
	})

	source := temporaryTaskPluginSource(t)
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(source)))
	c, recorder := taskPluginJSONContext(t, http.MethodPost, "/api/plugin/task", fmt.Sprintf(`{"source":%s,"sourceSha256":"mismatch"}`, quoteJSON(source)))
	UploadTaskPlugin(c)
	assert.Equal(t, false, decodeTaskPluginResponse(t, recorder)["success"])
	var rejected model.TaskPlugin
	assert.ErrorIs(t, database.Where("key = ?", "temporary-host-acceptance").First(&rejected).Error, gorm.ErrRecordNotFound)

	c, recorder = taskPluginJSONContext(t, http.MethodPost, "/api/plugin/task", `{"source":"export const meta = {};"}`)
	UploadTaskPlugin(c)
	assert.Equal(t, false, decodeTaskPluginResponse(t, recorder)["success"])

	c, recorder = taskPluginJSONContext(t, http.MethodPost, "/api/plugin/task", fmt.Sprintf(`{"source":%s,"enabled":true,"remark":"temporary acceptance","sourceSha256":"%s"}`, quoteJSON(source), digest))
	UploadTaskPlugin(c)
	response := decodeTaskPluginResponse(t, recorder)
	require.Equal(t, true, response["success"])

	var first model.TaskPlugin
	require.NoError(t, database.Where("key = ? AND version = ?", "temporary-host-acceptance", "1.0.0").First(&first).Error)
	assert.True(t, first.Active)
	assert.True(t, first.Enabled)
	assert.Equal(t, digest, first.SourceHash)

	c, recorder = taskPluginParamContext(t, http.MethodPost, "/api/plugin/task/temporary-host-acceptance/dryrun", "temporary-host-acceptance", "", `{"hook":"value","args":[]}`)
	DryRunTaskPlugin(c)
	response = decodeTaskPluginResponse(t, recorder)
	assert.Equal(t, true, response["success"])
	assert.Equal(t, "dry-run-ok", response["data"])

	secondSource := strings.Replace(source, `version: "1.0.0"`, `version: "1.0.1"`, 1)
	secondDigest := fmt.Sprintf("%x", sha256.Sum256([]byte(secondSource)))
	c, recorder = taskPluginJSONContext(t, http.MethodPut, "/api/plugin/task", fmt.Sprintf(`{"source":%s,"enabled":true,"sourceSha256":"%s"}`, quoteJSON(secondSource), secondDigest))
	UploadTaskPlugin(c)
	response = decodeTaskPluginResponse(t, recorder)
	require.Equal(t, true, response["success"])

	var versions []model.TaskPlugin
	require.NoError(t, database.Where("key = ?", "temporary-host-acceptance").Order("version").Find(&versions).Error)
	require.Len(t, versions, 2)
	assert.True(t, versions[0].Active)
	assert.False(t, versions[1].Active)

	c, recorder = taskPluginParamContext(t, http.MethodPost, "/api/plugin/task/temporary-host-acceptance/activate", "temporary-host-acceptance", "", `{"version":"1.0.1"}`)
	ActivateTaskPlugin(c)
	assert.Equal(t, true, decodeTaskPluginResponse(t, recorder)["success"])

	var active model.TaskPlugin
	require.NoError(t, database.Where("key = ? AND active = ?", "temporary-host-acceptance", true).First(&active).Error)
	assert.Equal(t, "1.0.1", active.Version)

	c, recorder = taskPluginParamContext(t, http.MethodPost, "/api/plugin/task/temporary-host-acceptance/status", "temporary-host-acceptance", "", `{"enabled":false}`)
	SetTaskPluginStatus(c)
	assert.Equal(t, true, decodeTaskPluginResponse(t, recorder)["success"])
	require.NoError(t, database.Where("key = ? AND active = ?", "temporary-host-acceptance", true).First(&active).Error)
	assert.False(t, active.Enabled)

	c, recorder = taskPluginParamContext(t, http.MethodPost, "/api/plugin/task/temporary-host-acceptance/status", "temporary-host-acceptance", "", `{"enabled":true}`)
	SetTaskPluginStatus(c)
	assert.Equal(t, true, decodeTaskPluginResponse(t, recorder)["success"])

	c, recorder = taskPluginParamContext(t, http.MethodDelete, "/api/plugin/task/temporary-host-acceptance/versions/1.0.0", "temporary-host-acceptance", "1.0.0", "")
	DeleteTaskPluginVersion(c)
	assert.Equal(t, true, decodeTaskPluginResponse(t, recorder)["success"])
	var deleted model.TaskPlugin
	assert.ErrorIs(t, database.Where("key = ? AND version = ?", "temporary-host-acceptance", "1.0.0").First(&deleted).Error, gorm.ErrRecordNotFound)
}

func quoteJSON(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
