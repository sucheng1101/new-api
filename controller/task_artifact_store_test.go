package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTaskArtifactContentServesStoredObjectBeforePluginProjection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDB := model.DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.Task{}, &model.TaskArtifactObject{}))
	model.DB = database
	t.Cleanup(func() { model.DB = previousDB })

	artifactBytes := []byte("stored-video")
	s3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "/task-artifacts/tasks/1/video", r.URL.Path)
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Content-Length", "12")
		_, _ = w.Write(artifactBytes)
	}))
	defer s3.Close()
	enableTaskArtifactS3StoreForControllerTest(t, s3.URL)

	task := &model.Task{
		TaskID: "task-stored-artifact", UserId: 42, Status: model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{Execution: &model.TaskExecutionSnapshot{TaskPlugin: &model.TaskPluginSnapshot{
			// No archive row exists for this snapshot. The handler must still
			// serve the persisted object instead of attempting projection first.
			Key: "deleted-plugin", Version: "1.0.0", SourceHash: "missing-source",
		}}},
	}
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.SaveTaskArtifactObject(&model.TaskArtifactObject{
		TaskRecordID: task.ID, ArtifactKey: "video", ArtifactType: "video", MimeType: "video/mp4",
		Backend: "s3", Bucket: "task-artifacts", ObjectKey: "tasks/1/video", Size: int64(len(artifactBytes)),
	}))

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set("id", task.UserId)
	context.Params = gin.Params{{Key: "key", Value: task.TaskID}, {Key: "artifact_key", Value: "video"}}
	context.Request = httptest.NewRequest(http.MethodGet, "/v1/tasks/"+task.TaskID+"/artifacts/video/content", nil)
	TaskArtifactContent(context)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, string(artifactBytes), recorder.Body.String())
	assert.Equal(t, "video/mp4", recorder.Header().Get("Content-Type"))
}

func enableTaskArtifactS3StoreForControllerTest(t *testing.T, endpoint string) {
	t.Helper()
	// Register this cleanup before t.Setenv so environment restoration runs
	// first and puts the global backend back into disabled/upstream mode.
	t.Cleanup(service.InitTaskArtifactStore)
	t.Setenv(system_setting.TaskArtifactStoreModeEnv, system_setting.TaskArtifactStoreModeS3)
	t.Setenv(system_setting.TaskArtifactStoreS3EndpointEnv, endpoint)
	t.Setenv(system_setting.TaskArtifactStoreS3BucketEnv, "task-artifacts")
	t.Setenv(system_setting.TaskArtifactStoreS3RegionEnv, "us-east-1")
	t.Setenv(system_setting.TaskArtifactStoreS3AccessKeyEnv, "test-access-key")
	t.Setenv(system_setting.TaskArtifactStoreS3SecretKeyEnv, "test-secret-key")
	t.Setenv(system_setting.TaskArtifactStoreS3PresignTTLEnv, "900")
	previousCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = previousCacheEnabled })
	service.InitHttpClient()
	service.InitTaskArtifactStore()
}

func TestWriteTaskArtifactsListsStoredObjectsWhenPluginSnapshotIsUnavailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDB := model.DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.Task{}, &model.TaskArtifactObject{}))
	model.DB = database
	t.Cleanup(func() { model.DB = previousDB })

	previousPublicAddress := system_setting.TaskPublicAddress
	system_setting.TaskPublicAddress = "https://gateway.example"
	t.Cleanup(func() { system_setting.TaskPublicAddress = previousPublicAddress })
	s3 := httptest.NewServer(http.NotFoundHandler())
	defer s3.Close()
	enableTaskArtifactS3StoreForControllerTest(t, s3.URL)
	task := &model.Task{
		TaskID: "task-stored-list", Status: model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{Execution: &model.TaskExecutionSnapshot{TaskPlugin: &model.TaskPluginSnapshot{
			Key: "deleted-plugin", Version: "1.0.0", SourceHash: "missing-source",
		}}},
	}
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.SaveTaskArtifactObject(&model.TaskArtifactObject{
		TaskRecordID: task.ID, ArtifactKey: "video", ArtifactType: "video", MimeType: "video/mp4",
		Backend: "s3", Bucket: "task-artifacts", ObjectKey: "tasks/1/video",
	}))

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/task/"+task.TaskID+"/artifacts", nil)
	writeTaskArtifacts(context, task, true)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"artifacts":[{"key":"video","type":"video","mime_type":"video/mp4"`)
	assert.Contains(t, recorder.Body.String(), "/v1/tasks/task-stored-list/artifacts/video/content?access=")
}
