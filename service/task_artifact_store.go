package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsv4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const taskArtifactStoreBackendS3 = "s3"

var (
	ErrTaskArtifactStoreDisabled  = errors.New("task artifact store is disabled")
	ErrTaskArtifactObjectNotFound = errors.New("task artifact object is not available")
)

// StoredArtifactRef describes a persisted artifact object. It deliberately
// excludes endpoint credentials and provider URLs.
type StoredArtifactRef struct {
	Key       string
	Type      string
	Backend   string
	Bucket    string
	ObjectKey string
	MimeType  string
	ETag      string
	Size      int64
}

// TaskArtifactStore is the persistence boundary for generated artifact bytes.
type TaskArtifactStore interface {
	Enabled() bool
	List(task *model.Task) ([]StoredArtifactRef, error)
	Resolve(task *model.Task, artifactKey string) (*StoredArtifactRef, error)
	Persist(ctx context.Context, task *model.Task, artifact types.TaskArtifact, content io.Reader, contentLength int64) (*StoredArtifactRef, error)
	Serve(c *gin.Context, task *model.Task, ref *StoredArtifactRef) error
}

type disabledArtifactStore struct{}

func (disabledArtifactStore) Enabled() bool { return false }

func (disabledArtifactStore) List(*model.Task) ([]StoredArtifactRef, error) { return nil, nil }

func (disabledArtifactStore) Resolve(*model.Task, string) (*StoredArtifactRef, error) {
	return nil, nil
}

func (disabledArtifactStore) Persist(context.Context, *model.Task, types.TaskArtifact, io.Reader, int64) (*StoredArtifactRef, error) {
	return nil, ErrTaskArtifactStoreDisabled
}

func (disabledArtifactStore) Serve(*gin.Context, *model.Task, *StoredArtifactRef) error {
	return ErrTaskArtifactStoreDisabled
}

type s3ArtifactStore struct {
	config system_setting.TaskArtifactStoreConfig
	client *http.Client
	signer *awsv4.Signer
}

func newS3ArtifactStore(config system_setting.TaskArtifactStoreConfig) (*s3ArtifactStore, error) {
	if config.Mode != system_setting.TaskArtifactStoreModeS3 {
		return nil, errors.New("task artifact store mode must be s3")
	}
	if err := system_setting.ValidateTaskArtifactStoreConfig(config); err != nil {
		return nil, err
	}
	endpoint, err := url.Parse(config.S3Endpoint)
	if err != nil || endpoint == nil || endpoint.Host == "" {
		return nil, errors.New("task artifact S3 endpoint is invalid")
	}
	client := GetHttpClient()
	if client == nil {
		client = http.DefaultClient
	}
	clonedClient := *client
	clonedClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &s3ArtifactStore{config: config, client: &clonedClient, signer: awsv4.NewSigner()}, nil
}

func (s *s3ArtifactStore) Enabled() bool { return s != nil }

func (s *s3ArtifactStore) List(task *model.Task) ([]StoredArtifactRef, error) {
	objects, err := model.ListTaskArtifactObjects(task)
	if err != nil {
		return nil, err
	}
	refs := make([]StoredArtifactRef, 0, len(objects))
	for _, object := range objects {
		if object.Backend == taskArtifactStoreBackendS3 {
			refs = append(refs, storedArtifactRefFromModel(object))
		}
	}
	return refs, nil
}

func (s *s3ArtifactStore) Resolve(task *model.Task, artifactKey string) (*StoredArtifactRef, error) {
	object, err := model.GetTaskArtifactObject(task, artifactKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if object.Backend != taskArtifactStoreBackendS3 {
		return nil, nil
	}
	ref := storedArtifactRefFromModel(*object)
	return &ref, nil
}

func storedArtifactRefFromModel(object model.TaskArtifactObject) StoredArtifactRef {
	return StoredArtifactRef{
		Key:       object.ArtifactKey,
		Type:      object.ArtifactType,
		Backend:   object.Backend,
		Bucket:    object.Bucket,
		ObjectKey: object.ObjectKey,
		MimeType:  object.MimeType,
		ETag:      object.ETag,
		Size:      object.Size,
	}
}

func (s *s3ArtifactStore) Persist(ctx context.Context, task *model.Task, artifact types.TaskArtifact, content io.Reader, contentLength int64) (*StoredArtifactRef, error) {
	if s == nil || task == nil || task.ID == 0 || content == nil {
		return nil, errors.New("task artifact persistence input is invalid")
	}
	if !validStoredArtifact(artifact) {
		return nil, errors.New("task artifact persistence identity is invalid")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	ref := &StoredArtifactRef{
		Key:       artifact.Key,
		Type:      artifact.Type,
		Backend:   taskArtifactStoreBackendS3,
		Bucket:    s.config.S3Bucket,
		ObjectKey: s.objectKey(task, artifact.Key),
		MimeType:  normalizedArtifactMimeType(artifact.MimeType),
	}
	uploadContent, uploadLength, cleanup, err := stageTaskArtifactUpload(content, contentLength)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	counted := &countingReader{Reader: uploadContent}
	req, err := s.newSignedRequest(ctx, http.MethodPut, ref, counted, uploadLength, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upload task artifact object: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusNoContent {
		return nil, fmt.Errorf("upload task artifact object: S3 returned HTTP %d", resp.StatusCode)
	}
	ref.ETag = boundedHeader(resp.Header.Get("ETag"), 512)
	ref.Size = counted.N
	if ref.Size != uploadLength {
		return nil, fmt.Errorf("upload task artifact object: expected %d bytes, sent %d", uploadLength, ref.Size)
	}
	if err := model.SaveTaskArtifactObject(&model.TaskArtifactObject{
		TaskRecordID: task.ID,
		ArtifactKey:  ref.Key,
		ArtifactType: ref.Type,
		MimeType:     ref.MimeType,
		Backend:      ref.Backend,
		Bucket:       ref.Bucket,
		ObjectKey:    ref.ObjectKey,
		ETag:         ref.ETag,
		Size:         ref.Size,
	}); err != nil {
		return nil, fmt.Errorf("record task artifact object: %w", err)
	}
	return ref, nil
}

func (s *s3ArtifactStore) Serve(c *gin.Context, _ *model.Task, ref *StoredArtifactRef) error {
	if s == nil || c == nil || ref == nil || ref.Backend != taskArtifactStoreBackendS3 {
		return ErrTaskArtifactObjectNotFound
	}
	method := c.Request.Method
	if method != http.MethodGet && method != http.MethodHead {
		return errors.New("task artifact object method is invalid")
	}
	requestHeaders := make(http.Header, 4)
	for _, name := range []string{"Range", "If-Range", "If-None-Match", "If-Modified-Since"} {
		if value := strings.TrimSpace(c.Request.Header.Get(name)); value != "" {
			requestHeaders.Set(name, value)
		}
	}
	req, err := s.newSignedRequest(c.Request.Context(), method, ref, nil, -1, requestHeaders)
	if err != nil {
		return err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("read task artifact object: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK, http.StatusPartialContent, http.StatusNotModified, http.StatusRequestedRangeNotSatisfiable:
		types.TaskArtifactResponseHeaders(c.Writer.Header(), resp.Header)
		if c.Writer.Header().Get("Content-Type") == "" && ref.MimeType != "" {
			c.Writer.Header().Set("Content-Type", ref.MimeType)
		}
		setStoredArtifactResponseSecurityHeaders(c.Writer.Header())
		c.Status(resp.StatusCode)
		c.Writer.WriteHeaderNow()
		if method == http.MethodHead || resp.StatusCode == http.StatusNotModified {
			return nil
		}
		_, err = io.Copy(c.Writer, resp.Body)
		return err
	case http.StatusNotFound, http.StatusGone:
		return ErrTaskArtifactObjectNotFound
	default:
		return fmt.Errorf("read task artifact object: S3 returned HTTP %d", resp.StatusCode)
	}
}

func (s *s3ArtifactStore) newSignedRequest(ctx context.Context, method string, ref *StoredArtifactRef, body io.Reader, contentLength int64, headers http.Header) (*http.Request, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	endpoint, err := s.objectURL(ref)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint.String(), body)
	if err != nil {
		return nil, err
	}
	if body != nil && contentLength >= 0 {
		req.ContentLength = contentLength
	}
	for name, values := range headers {
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}
	if method == http.MethodPut && ref.MimeType != "" {
		req.Header.Set("Content-Type", ref.MimeType)
	}
	const unsignedPayload = "UNSIGNED-PAYLOAD"
	req.Header.Set("X-Amz-Content-Sha256", unsignedPayload)
	err = s.signer.SignHTTP(ctx, aws.Credentials{
		AccessKeyID:     s.config.S3AccessKey,
		SecretAccessKey: s.config.S3SecretKey,
		Source:          "new-api-task-artifact-store",
	}, req, unsignedPayload, "s3", s.config.S3Region, time.Now())
	if err != nil {
		return nil, fmt.Errorf("sign task artifact S3 request: %w", err)
	}
	return req, nil
}

// stageTaskArtifactUpload returns a reader with a deterministic content
// length. S3-compatible servers such as MinIO may reject chunked PUT uploads.
// When the upstream does not send Content-Length, use a bounded temporary file
// instead of buffering a potentially large video in memory.
func stageTaskArtifactUpload(content io.Reader, contentLength int64) (io.Reader, int64, func(), error) {
	if contentLength < -1 || contentLength > maxPersistedTaskArtifactBytes {
		return nil, 0, nil, fmt.Errorf("task artifact exceeds %d bytes", maxPersistedTaskArtifactBytes)
	}
	if contentLength >= 0 {
		return content, contentLength, func() {}, nil
	}

	file, err := os.CreateTemp("", "new-api-task-artifact-*")
	if err != nil {
		return nil, 0, nil, fmt.Errorf("stage task artifact: %w", err)
	}
	cleanup := func() {
		_ = file.Close()
		_ = os.Remove(file.Name())
	}
	written, err := io.Copy(file, io.LimitReader(content, maxPersistedTaskArtifactBytes+1))
	if err != nil {
		cleanup()
		return nil, 0, nil, fmt.Errorf("stage task artifact: %w", err)
	}
	if written > maxPersistedTaskArtifactBytes {
		cleanup()
		return nil, 0, nil, fmt.Errorf("task artifact exceeds %d bytes", maxPersistedTaskArtifactBytes)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, nil, fmt.Errorf("rewind staged task artifact: %w", err)
	}
	return file, written, cleanup, nil
}

func (s *s3ArtifactStore) objectURL(ref *StoredArtifactRef) (*url.URL, error) {
	if ref == nil || ref.Bucket != s.config.S3Bucket || strings.TrimSpace(ref.ObjectKey) == "" {
		return nil, ErrTaskArtifactObjectNotFound
	}
	endpoint, err := url.Parse(s.config.S3Endpoint)
	if err != nil || endpoint == nil || endpoint.Host == "" {
		return nil, errors.New("task artifact S3 endpoint is invalid")
	}
	endpoint.RawQuery = ""
	endpoint.Fragment = ""
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/") + "/" + ref.Bucket + "/" + ref.ObjectKey
	endpoint.RawPath = ""
	return endpoint, nil
}

func (s *s3ArtifactStore) objectKey(task *model.Task, artifactKey string) string {
	prefix := strings.Trim(s.config.S3Prefix, "/")
	parts := make([]string, 0, 4)
	if prefix != "" {
		parts = append(parts, prefix)
	}
	parts = append(parts, "tasks", fmt.Sprintf("%d", task.ID), artifactKey)
	return strings.Join(parts, "/")
}

type countingReader struct {
	io.Reader
	N int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.N += int64(n)
	return n, err
}

func validStoredArtifact(artifact types.TaskArtifact) bool {
	key := strings.TrimSpace(artifact.Key)
	if key == "" || key != artifact.Key || len(key) > 128 {
		return false
	}
	for _, character := range key {
		if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || strings.ContainsRune("._~-", character)) {
			return false
		}
	}
	switch artifact.Type {
	case "video", "audio", "image", "file":
		return len(artifact.MimeType) <= 255 && !strings.ContainsAny(artifact.MimeType, "\r\n")
	default:
		return false
	}
}

func normalizedArtifactMimeType(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 255 || strings.ContainsAny(value, "\r\n") {
		return ""
	}
	return value
}

func boundedHeader(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) > max || strings.ContainsAny(value, "\r\n") {
		return ""
	}
	return value
}

func setStoredArtifactResponseSecurityHeaders(header http.Header) {
	header.Set("Cache-Control", "private, no-store")
	header.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
}

var (
	taskArtifactStoreMu sync.RWMutex
	taskArtifactStore   TaskArtifactStore = &disabledArtifactStore{}
)

// InitTaskArtifactStore selects the configured backend after environment and
// HTTP resources have been initialized. Invalid configuration leaves the
// existing upstream-proxy behavior active.
func InitTaskArtifactStore() {
	config := system_setting.LoadTaskArtifactStoreConfig()
	var next TaskArtifactStore = &disabledArtifactStore{}
	if config.Mode == system_setting.TaskArtifactStoreModeS3 {
		store, err := newS3ArtifactStore(config)
		if err != nil {
			common.SysError("initialize task artifact S3 store failed: " + err.Error())
		} else {
			next = store
		}
	}
	taskArtifactStoreMu.Lock()
	taskArtifactStore = next
	taskArtifactStoreMu.Unlock()
}

func GetTaskArtifactStore() TaskArtifactStore {
	taskArtifactStoreMu.RLock()
	defer taskArtifactStoreMu.RUnlock()
	return taskArtifactStore
}
