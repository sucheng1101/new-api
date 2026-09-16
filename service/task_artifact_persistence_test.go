package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type artifactPersistenceTestAdaptor struct {
	contentURL string
	initInfo   *relaycommon.RelayInfo
}

func (a *artifactPersistenceTestAdaptor) Init(info *relaycommon.RelayInfo) { a.initInfo = info }

func (*artifactPersistenceTestAdaptor) FetchTask(string, string, *model.Task, string) (*http.Response, error) {
	return nil, nil
}

func (*artifactPersistenceTestAdaptor) ParseTaskResult(*model.Task, *http.Response, []byte) (*relaycommon.TaskInfo, error) {
	return nil, nil
}

func (*artifactPersistenceTestAdaptor) AdjustBillingOnComplete(*model.Task, *relaycommon.TaskInfo) int {
	return 0
}

func (*artifactPersistenceTestAdaptor) ListArtifacts(*model.Task) ([]types.TaskArtifact, error) {
	return []types.TaskArtifact{{Key: "video", Type: "video", MimeType: "video/mp4"}}, nil
}

func (a *artifactPersistenceTestAdaptor) BuildContentRequest(_ *model.Task, key string, request types.TaskArtifactClientRequest) (*types.TaskContentRequest, error) {
	if key != "video" || request.Method != http.MethodGet {
		return nil, errTaskArtifactPersistenceRejected
	}
	return &types.TaskContentRequest{
		URL:     a.contentURL,
		Method:  http.MethodGet,
		Headers: map[string]string{"Authorization": "Bearer provider-key"},
	}, nil
}

func TestPersistCompletedTaskArtifactsCapturesPluginContentWithoutChangingTaskState(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)

	fetchSetting := system_setting.GetFetchSetting()
	previousFetchSetting := *fetchSetting
	*fetchSetting = system_setting.FetchSetting{EnableSSRFProtection: false}
	t.Cleanup(func() { *fetchSetting = previousFetchSetting })

	content := []byte("persisted-video-bytes")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer provider-key", r.Header.Get("Authorization"))
		assert.Equal(t, "/artifact/video", r.URL.Path)
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Content-Length", "21")
		_, _ = w.Write(content)
	}))
	defer provider.Close()

	var objectMu sync.Mutex
	objects := make(map[string][]byte)
	s3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPut, r.Method)
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		objectMu.Lock()
		objects[r.URL.Path] = body
		objectMu.Unlock()
		w.Header().Set("ETag", `"task-artifact"`)
		w.WriteHeader(http.StatusOK)
	}))
	defer s3.Close()

	store, err := newS3ArtifactStore(system_setting.TaskArtifactStoreConfig{
		Mode:                system_setting.TaskArtifactStoreModeS3,
		S3Endpoint:          s3.URL,
		S3Bucket:            "task-artifacts",
		S3Region:            "us-east-1",
		S3AccessKey:         "test-access-key",
		S3SecretKey:         "test-secret-key",
		S3PresignTTLSeconds: system_setting.DefaultTaskArtifactStorePresignTTLSeconds,
	})
	require.NoError(t, err)
	replaceTaskArtifactStoreForTest(t, store)

	baseURL := provider.URL
	channel := &model.Channel{
		Id: 8721, Type: constant.ChannelTypeTaskPlugin, Name: "artifact-plugin-channel",
		Key: "provider-key", BaseURL: &baseURL, Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, model.DB.Create(channel).Error)
	task := &model.Task{
		TaskID: "task-persisted-plugin-artifact", ChannelId: channel.Id,
		Status: model.TaskStatusSuccess, CreatedAt: time.Now().Unix(), UpdatedAt: time.Now().Unix(),
		PrivateData: model.TaskPrivateData{Execution: &model.TaskExecutionSnapshot{TaskPlugin: &model.TaskPluginSnapshot{
			Key: "prompt-hubs", Version: "1.2.3", SourceHash: "source-hash",
		}}},
	}
	require.NoError(t, model.DB.Create(task).Error)

	adaptor := &artifactPersistenceTestAdaptor{contentURL: provider.URL + "/artifact/video"}
	PersistCompletedTaskArtifactsWithAdaptor(context.Background(), task, adaptor)

	assert.Equal(t, model.TaskStatus(model.TaskStatusSuccess), task.Status)
	require.NotNil(t, adaptor.initInfo)
	assert.Equal(t, "provider-key", adaptor.initInfo.ChannelMeta.ApiKey)
	refs, err := store.List(task)
	require.NoError(t, err)
	require.Len(t, refs, 1)
	assert.Equal(t, "video", refs[0].Key)
	assert.Equal(t, "video/mp4", refs[0].MimeType)
	objectMu.Lock()
	assert.Equal(t, content, objects["/task-artifacts/tasks/"+fmt.Sprintf("%d", task.ID)+"/video"])
	objectMu.Unlock()
}

func replaceTaskArtifactStoreForTest(t *testing.T, store TaskArtifactStore) {
	t.Helper()
	taskArtifactStoreMu.Lock()
	previous := taskArtifactStore
	taskArtifactStore = store
	taskArtifactStoreMu.Unlock()
	t.Cleanup(func() {
		taskArtifactStoreMu.Lock()
		taskArtifactStore = previous
		taskArtifactStoreMu.Unlock()
	})
}

var _ TaskPollingAdaptor = (*artifactPersistenceTestAdaptor)(nil)

func TestLimitedTaskArtifactReadCloserRejectsBytesPastLimit(t *testing.T) {
	reader := &limitedTaskArtifactReadCloser{ReadCloser: io.NopCloser(bytes.NewBufferString("ab")), remaining: 1}
	buffer := make([]byte, 2)
	n, err := reader.Read(buffer)
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	_, err = reader.Read(buffer)
	assert.ErrorContains(t, err, "exceeds")
}
