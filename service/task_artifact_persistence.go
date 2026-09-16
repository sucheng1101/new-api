package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/QuantumNous/new-api/types"
	"golang.org/x/net/http/httpguts"
)

const maxPersistedTaskArtifactBytes int64 = 1 << 30

var errTaskArtifactPersistenceRejected = errors.New("task artifact persistence request rejected")

// taskArtifactPersistenceAdaptor is intentionally defined in service. The
// relay/channel package aliases the transport types, which keeps polling from
// importing relay while still allowing plugin adaptors to satisfy it.
type taskArtifactPersistenceAdaptor interface {
	ListArtifacts(task *model.Task) ([]types.TaskArtifact, error)
	BuildContentRequest(task *model.Task, artifactKey string, clientRequest types.TaskArtifactClientRequest) (*types.TaskContentRequest, error)
}

// PersistCompletedTaskArtifacts resolves the task's archived plugin snapshot
// and captures all successful outputs when durable object storage is enabled.
// It is intentionally best-effort: task success and billing are already
// committed before this work starts.
func PersistCompletedTaskArtifacts(ctx context.Context, task *model.Task) {
	PersistCompletedTaskArtifactsWithAdaptor(ctx, task, taskPollingAdaptor(task))
}

// PersistCompletedTaskArtifactsWithAdaptor is the polling-path variant. The
// caller may pass the already selected adaptor so a channel with multiple
// plugins continues using the task's exact snapshot.
func PersistCompletedTaskArtifactsWithAdaptor(ctx context.Context, task *model.Task, adaptor TaskPollingAdaptor) {
	store := GetTaskArtifactStore()
	if !store.Enabled() || task == nil || task.Status != model.TaskStatusSuccess || !taskHasArchivedPlugin(task) {
		return
	}
	provider, ok := adaptor.(taskArtifactPersistenceAdaptor)
	if !ok || adaptor == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := initializeTaskArtifactPersistenceAdaptor(task, adaptor); err != nil {
		logTaskArtifactPersistenceWarning(ctx, task, "initialize", err)
		return
	}
	artifacts, err := provider.ListArtifacts(task)
	if err != nil {
		logTaskArtifactPersistenceWarning(ctx, task, "list", err)
		return
	}
	for _, artifact := range artifacts {
		if !validStoredArtifact(artifact) {
			logTaskArtifactPersistenceWarning(ctx, task, "validate", errors.New("plugin returned an invalid artifact"))
			continue
		}
		if existing, resolveErr := store.Resolve(task, artifact.Key); resolveErr != nil {
			logTaskArtifactPersistenceWarning(ctx, task, "resolve", resolveErr)
			continue
		} else if existing != nil {
			continue
		}
		descriptor, buildErr := provider.BuildContentRequest(task, artifact.Key, types.TaskArtifactClientRequest{Method: http.MethodGet})
		if buildErr != nil || descriptor == nil {
			if buildErr == nil {
				buildErr = errors.New("plugin returned no content request")
			}
			logTaskArtifactPersistenceWarning(ctx, task, "build", buildErr)
			continue
		}
		content, contentLength, mimeType, fetchErr := fetchTaskArtifactForPersistence(ctx, task, descriptor)
		if fetchErr != nil {
			logTaskArtifactPersistenceWarning(ctx, task, "fetch", fetchErr)
			continue
		}
		if mimeType != "" {
			artifact.MimeType = mimeType
		}
		_, persistErr := store.Persist(ctx, task, artifact, content, contentLength)
		closeErr := content.Close()
		if persistErr != nil {
			logTaskArtifactPersistenceWarning(ctx, task, "store", persistErr)
			continue
		}
		if closeErr != nil {
			logTaskArtifactPersistenceWarning(ctx, task, "close", closeErr)
		}
	}
}

func taskHasArchivedPlugin(task *model.Task) bool {
	return task != nil && task.PrivateData.Execution != nil && task.PrivateData.Execution.TaskPlugin != nil &&
		strings.TrimSpace(task.PrivateData.Execution.TaskPlugin.Key) != ""
}

func initializeTaskArtifactPersistenceAdaptor(task *model.Task, adaptor TaskPollingAdaptor) error {
	channel, err := model.CacheGetChannel(task.ChannelId)
	if err != nil || channel == nil {
		return errors.New("artifact channel is unavailable")
	}
	baseURL := channel.GetBaseURL()
	if baseURL == "" {
		baseURL = constant.GetChannelBaseURL(channel.Type)
	}
	key := channel.Key
	if channel.Type != constant.ChannelTypeTaskPlugin && task.PrivateData.Key != "" {
		key = task.PrivateData.Key
	}
	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType:    channel.Type,
		ChannelBaseUrl: baseURL,
		ApiKey:         key,
		ChannelSetting: channel.GetSetting(),
	}})
	return nil
}

func fetchTaskArtifactForPersistence(ctx context.Context, task *model.Task, descriptor *types.TaskContentRequest) (io.ReadCloser, int64, string, error) {
	if descriptor == nil || task == nil {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}
	rawURL := strings.TrimSpace(descriptor.URL)
	if rawURL == "" || len(rawURL) > 64<<10 {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}
	parsedURL, err := url.Parse(rawURL)
	if err != nil || parsedURL == nil || parsedURL.Host == "" || parsedURL.User != nil ||
		(parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Fragment != "" {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}
	method := strings.ToUpper(strings.TrimSpace(descriptor.Method))
	if method == "" {
		method = http.MethodGet
	}
	if method != http.MethodGet && method != http.MethodPost {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}
	if len(descriptor.Body) > 1<<20 {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}
	if descriptor.Credentialless && (method != http.MethodGet || len(descriptor.Headers) != 0 || len(descriptor.Body) != 0) {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}
	if descriptor.DropCredentialsOnRedirect &&
		(descriptor.Credentialless || method != http.MethodGet || len(descriptor.Body) != 0) {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}
	if err := validateTaskArtifactPersistenceURL(rawURL, task); err != nil {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}

	channel, err := model.CacheGetChannel(task.ChannelId)
	if err != nil || channel == nil {
		return nil, 0, "", errors.New("artifact channel is unavailable")
	}
	client := GetSSRFProtectedHTTPClient()
	proxy := strings.TrimSpace(channel.GetSetting().Proxy)
	if proxy != "" {
		client, err = GetHttpClientWithProxy(proxy)
		if err != nil {
			return nil, 0, "", err
		}
	}
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, method, parsedURL.String(), bytes.NewReader(descriptor.Body))
	if err != nil {
		return nil, 0, "", err
	}
	if err := applyTaskArtifactPersistenceHeaders(req.Header, descriptor.Headers); err != nil {
		return nil, 0, "", errTaskArtifactPersistenceRejected
	}

	requestClient := taskArtifactPersistenceRedirectClient(client, task, descriptor.Credentialless, descriptor.DropCredentialsOnRedirect)
	resp, err := requestClient.Do(req)
	if err != nil {
		return nil, 0, "", err
	}
	switch resp.StatusCode {
	case http.StatusOK, http.StatusPartialContent:
		if resp.ContentLength > maxPersistedTaskArtifactBytes {
			_ = resp.Body.Close()
			return nil, 0, "", fmt.Errorf("task artifact exceeds %d bytes", maxPersistedTaskArtifactBytes)
		}
		mimeType := normalizedArtifactMimeType(resp.Header.Get("Content-Type"))
		return &limitedTaskArtifactReadCloser{ReadCloser: resp.Body, remaining: maxPersistedTaskArtifactBytes}, resp.ContentLength, mimeType, nil
	default:
		_ = resp.Body.Close()
		return nil, 0, "", fmt.Errorf("artifact upstream returned HTTP %d", resp.StatusCode)
	}
}

func validateTaskArtifactPersistenceURL(rawURL string, task *model.Task) error {
	if task == nil {
		return errTaskArtifactPersistenceRejected
	}
	channel, err := model.CacheGetChannel(task.ChannelId)
	if err != nil || channel == nil {
		return errTaskArtifactPersistenceRejected
	}
	fetchSetting := system_setting.GetFetchSetting()
	return common.ValidateURLWithFetchSetting(
		rawURL,
		fetchSetting.EnableSSRFProtection,
		fetchSetting.AllowPrivateIp,
		fetchSetting.DomainFilterMode,
		fetchSetting.IpFilterMode,
		fetchSetting.DomainList,
		fetchSetting.IpList,
		fetchSetting.AllowedPorts,
		fetchSetting.ApplyIPFilterForDomain,
	)
}

func applyTaskArtifactPersistenceHeaders(destination http.Header, headers map[string]string) error {
	if len(headers) > 64 {
		return errTaskArtifactPersistenceRejected
	}
	for name, value := range headers {
		name = strings.TrimSpace(name)
		if !httpguts.ValidHeaderFieldName(name) || !httpguts.ValidHeaderFieldValue(value) || len(value) > 8192 {
			return errTaskArtifactPersistenceRejected
		}
		switch strings.ToLower(name) {
		case "host", "content-length", "accept-encoding", "connection", "proxy-connection", "keep-alive",
			"proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
			return errTaskArtifactPersistenceRejected
		}
		destination.Set(name, value)
	}
	return nil
}

func taskArtifactPersistenceRedirectClient(base *http.Client, task *model.Task, credentialless bool, dropCredentialsOnRedirect bool) *http.Client {
	cloned := *base
	cloned.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 || req.URL == nil || req.URL.Host == "" || req.URL.User != nil ||
			(req.URL.Scheme != "http" && req.URL.Scheme != "https") || req.URL.Fragment != "" {
			return errTaskArtifactPersistenceRejected
		}
		if err := validateTaskArtifactPersistenceURL(req.URL.String(), task); err != nil {
			return errTaskArtifactPersistenceRejected
		}
		if len(via) > 0 && !sameArtifactPersistenceOrigin(via[len(via)-1].URL, req.URL) {
			if !credentialless && !dropCredentialsOnRedirect {
				return errTaskArtifactPersistenceRejected
			}
			for name := range req.Header {
				req.Header.Del(name)
			}
			req.Body = http.NoBody
			req.GetBody = nil
			req.ContentLength = 0
		}
		return nil
	}
	return &cloned
}

func sameArtifactPersistenceOrigin(left, right *url.URL) bool {
	if left == nil || right == nil {
		return false
	}
	return strings.EqualFold(left.Scheme, right.Scheme) &&
		strings.EqualFold(normalizedArtifactPersistenceHost(left.Scheme, left.Host), normalizedArtifactPersistenceHost(right.Scheme, right.Host))
}

func normalizedArtifactPersistenceHost(scheme, host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	hostName, port, err := net.SplitHostPort(host)
	if err != nil {
		return strings.TrimSuffix(host, ".")
	}
	hostName = strings.TrimSuffix(strings.ToLower(hostName), ".")
	if (strings.EqualFold(scheme, "http") && port == "80") || (strings.EqualFold(scheme, "https") && port == "443") {
		return hostName
	}
	return net.JoinHostPort(hostName, port)
}

type limitedTaskArtifactReadCloser struct {
	io.ReadCloser
	remaining int64
}

func (r *limitedTaskArtifactReadCloser) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		var probe [1]byte
		n, err := r.ReadCloser.Read(probe[:])
		if n > 0 {
			return 0, fmt.Errorf("task artifact exceeds %d bytes", maxPersistedTaskArtifactBytes)
		}
		return 0, err
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.ReadCloser.Read(p)
	r.remaining -= int64(n)
	return n, err
}

func logTaskArtifactPersistenceWarning(ctx context.Context, task *model.Task, stage string, _ error) {
	taskID := "unknown"
	if task != nil {
		taskID = task.TaskID
	}
	// Provider descriptors, URLs and response bodies may contain credentials.
	logger.LogWarn(ctx, fmt.Sprintf("task artifact persistence failed task=%s stage=%s", taskID, stage))
}
