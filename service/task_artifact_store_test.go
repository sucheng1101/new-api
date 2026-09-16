package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDisabledTaskArtifactStoreHasNoStorageBehavior(t *testing.T) {
	store := GetTaskArtifactStore()
	require.NotNil(t, store)
	assert.False(t, store.Enabled())

	task := &model.Task{TaskID: "task-disabled-store"}
	refs, err := store.List(task)
	require.NoError(t, err)
	assert.Empty(t, refs)

	ref, err := store.Resolve(task, "video")
	require.NoError(t, err)
	assert.Nil(t, ref)

	ref, err = store.Persist(t.Context(), task, types.TaskArtifact{Key: "video", Type: "video"}, strings.NewReader("content"), -1)
	assert.Nil(t, ref)
	assert.ErrorIs(t, err, ErrTaskArtifactStoreDisabled)
	assert.ErrorIs(t, store.Serve(&gin.Context{}, task, &StoredArtifactRef{Backend: "s3"}), ErrTaskArtifactStoreDisabled)
	assert.Same(t, store, GetTaskArtifactStore())
}

var _ TaskArtifactStore = disabledArtifactStore{}

func TestS3ArtifactStorePersistsMetadataAndServesRange(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)

	var objectsMu sync.Mutex
	objects := make(map[string][]byte)
	s3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		assert.NotEmpty(t, r.Header.Get("X-Amz-Date"))
		assert.Equal(t, "UNSIGNED-PAYLOAD", r.Header.Get("X-Amz-Content-Sha256"))
		objectsMu.Lock()
		defer objectsMu.Unlock()
		switch r.Method {
		case http.MethodPut:
			assert.EqualValues(t, 6, r.ContentLength)
			body, err := io.ReadAll(r.Body)
			require.NoError(t, err)
			objects[r.URL.Path] = body
			w.Header().Set("ETag", `"artifact-etag"`)
			w.WriteHeader(http.StatusOK)
		case http.MethodGet, http.MethodHead:
			body, found := objects[r.URL.Path]
			if !found {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			start, end := 0, len(body)-1
			status := http.StatusOK
			if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
				_, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end)
				require.NoError(t, err)
				status = http.StatusPartialContent
				w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(body)))
			}
			payload := body[start : end+1]
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(payload)))
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("ETag", `"artifact-etag"`)
			w.WriteHeader(status)
			if r.Method != http.MethodHead {
				_, _ = w.Write(payload)
			}
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer s3.Close()

	store, err := newS3ArtifactStore(system_setting.TaskArtifactStoreConfig{
		Mode:                system_setting.TaskArtifactStoreModeS3,
		S3Endpoint:          s3.URL,
		S3Bucket:            "task-artifacts",
		S3Region:            "us-east-1",
		S3AccessKey:         "test-access-key",
		S3SecretKey:         "test-secret-key",
		S3Prefix:            "generated",
		S3PresignTTLSeconds: system_setting.DefaultTaskArtifactStorePresignTTLSeconds,
	})
	require.NoError(t, err)

	task := &model.Task{
		TaskID:    "task-artifact-store",
		Status:    model.TaskStatusSuccess,
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
	}
	require.NoError(t, model.DB.Create(task).Error)
	ref, err := store.Persist(context.Background(), task, types.TaskArtifact{
		Key: "video", Type: "video", MimeType: "video/mp4",
	}, bytes.NewBufferString("abcdef"), -1)
	require.NoError(t, err)
	require.NotNil(t, ref)
	assert.Equal(t, int64(6), ref.Size)
	assert.Equal(t, "generated/tasks/"+fmt.Sprintf("%d", task.ID)+"/video", ref.ObjectKey)

	refs, err := store.List(task)
	require.NoError(t, err)
	require.Len(t, refs, 1)
	assert.Equal(t, "video", refs[0].Key)
	assert.Equal(t, `"artifact-etag"`, refs[0].ETag)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "http://gateway.example/v1/tasks/task-artifact-store/artifacts/video/content", nil)
	context.Request.Header.Set("Range", "bytes=2-4")
	require.NoError(t, store.Serve(context, task, ref))
	assert.Equal(t, http.StatusPartialContent, recorder.Code)
	assert.Equal(t, "cde", recorder.Body.String())
	assert.Equal(t, "bytes 2-4/6", recorder.Header().Get("Content-Range"))
	assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
}

// TestS3ArtifactStoreMinIOIntegration verifies the actual SigV4 transport
// against a locally supplied MinIO instance. It stays opt-in so ordinary unit
// test runs never require Docker or object-store credentials.
func TestS3ArtifactStoreMinIOIntegration(t *testing.T) {
	if os.Getenv("NEW_API_TASK_ARTIFACT_MINIO_INTEGRATION") != "1" {
		t.Skip("set NEW_API_TASK_ARTIFACT_MINIO_INTEGRATION=1 to run against MinIO")
	}
	truncate(t)
	gin.SetMode(gin.TestMode)

	config := system_setting.TaskArtifactStoreConfig{
		Mode:                system_setting.TaskArtifactStoreModeS3,
		S3Endpoint:          os.Getenv(system_setting.TaskArtifactStoreS3EndpointEnv),
		S3Bucket:            os.Getenv(system_setting.TaskArtifactStoreS3BucketEnv),
		S3Region:            os.Getenv(system_setting.TaskArtifactStoreS3RegionEnv),
		S3AccessKey:         os.Getenv(system_setting.TaskArtifactStoreS3AccessKeyEnv),
		S3SecretKey:         os.Getenv(system_setting.TaskArtifactStoreS3SecretKeyEnv),
		S3Prefix:            "integration-test",
		S3PresignTTLSeconds: system_setting.DefaultTaskArtifactStorePresignTTLSeconds,
	}
	store, err := newS3ArtifactStore(config)
	require.NoError(t, err)

	task := &model.Task{
		TaskID:    "task-artifact-minio-integration",
		Status:    model.TaskStatusSuccess,
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
	}
	require.NoError(t, model.DB.Create(task).Error)
	artifact := types.TaskArtifact{Key: "video", Type: "video", MimeType: "video/mp4"}
	content := []byte("minio-artifact-content")
	ref, err := store.Persist(t.Context(), task, artifact, bytes.NewReader(content), int64(len(content)))
	require.NoError(t, err)
	require.NotNil(t, ref)
	t.Cleanup(func() {
		req, requestErr := store.newSignedRequest(context.Background(), http.MethodDelete, ref, nil, -1, nil)
		if requestErr != nil {
			t.Errorf("build MinIO cleanup request: %v", requestErr)
			return
		}
		resp, requestErr := store.client.Do(req)
		if requestErr != nil {
			t.Errorf("delete MinIO test object: %v", requestErr)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
			t.Errorf("delete MinIO test object: unexpected HTTP %d", resp.StatusCode)
		}
	})

	stored, err := store.Resolve(task, artifact.Key)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, int64(len(content)), stored.Size)

	recorder := httptest.NewRecorder()
	requestContext, _ := gin.CreateTestContext(recorder)
	requestContext.Request = httptest.NewRequest(http.MethodGet, "/v1/tasks/"+task.TaskID+"/artifacts/video/content", nil)
	requestContext.Request.Header.Set("Range", "bytes=6-13")
	require.NoError(t, store.Serve(requestContext, task, stored))
	assert.Equal(t, http.StatusPartialContent, recorder.Code)
	assert.Equal(t, string(content[6:14]), recorder.Body.String())
}
