package plugins_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	taskplugin "github.com/QuantumNous/new-api/relay/channel/task/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadPromptHubsPlugin(t *testing.T) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := builtinplugins.Source("prompt-hubs")
	require.NoError(t, err)
	plugin, err := jsplugin.NewRegistry().RegisterFactory(source, jsplugin.Options{Key: "prompt-hubs"})
	require.NoError(t, err)
	return plugin
}

func promptHubsObject(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var object map[string]any
	require.NoError(t, common.Unmarshal(encoded, &object))
	return object
}

func promptHubsHook(t *testing.T, plugin *jsplugin.LoadedPlugin, hook string, args ...any) map[string]any {
	t.Helper()
	value, err := plugin.Engine.Call(t.Context(), hook, args...)
	require.NoError(t, err)
	return promptHubsObject(t, value)
}

func promptHubsSubmitContext(publicModel, upstreamModel string, request map[string]any) map[string]any {
	return map[string]any{
		"baseUrl":       "https://console.prompt-hubs.example/",
		"apiKey":        "test-provider-key",
		"model":         publicModel,
		"upstreamModel": upstreamModel,
		"requestBody":   request,
	}
}

func promptHubsURLs(count int, prefix string) []any {
	urls := make([]any, 0, count)
	for index := range count {
		urls = append(urls, "https://cdn.example/"+prefix+"-"+string(rune('a'+index))+".bin")
	}
	return urls
}

func TestPromptHubsMetadataAndUsageProfiles(t *testing.T) {
	plugin := loadPromptHubsPlugin(t)
	assert.Equal(t, "1.0.2", plugin.Meta.Version)
	assert.Equal(t, []string{
		"minimax_h3",
		"MiniMax-H3-漫剧优化",
		"MiniMax-H3-量化版",
		"MiniMax-H3-四步采样版",
	}, plugin.Meta.Models)

	expectedResolutions := map[string][]string{
		"minimax_h3":       {"768", "1080p", "2K", "4K"},
		"MiniMax-H3-漫剧优化":  {"768", "2K", "4K"},
		"MiniMax-H3-量化版":   {"768"},
		"MiniMax-H3-四步采样版": {"768", "1080p"},
	}
	for modelName, wantResolutions := range expectedResolutions {
		t.Run(modelName, func(t *testing.T) {
			schema, examples := plugin.Meta.UsageForModel(modelName)
			require.Len(t, schema, 2)
			assert.Equal(t, wantResolutions, schema["resolution"].Enum)
			assert.Equal(t, "second", schema["seconds"].Unit)
			require.Len(t, examples, 2)
			for _, example := range examples {
				assert.Equal(t, []string{"resolution", "seconds"}, promptHubsSortedKeys(example.Facts))
			}
		})
	}
}

func promptHubsSortedKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func TestPromptHubsBuildSubmitRequest(t *testing.T) {
	plugin := loadPromptHubsPlugin(t)
	testCases := []struct {
		name          string
		publicModel   string
		upstreamModel string
		request       map[string]any
		wantSeconds   float64
		wantSize      string
		wantAction    string
		wantImages    bool
	}{
		{
			name:        "base H3 uses a high-resolution reference image",
			publicModel: "minimax_h3", upstreamModel: "minimax_h3",
			request: map[string]any{"model": "minimax_h3", "prompt": "river", "seconds": 5, "size": "2K", "metadata": map[string]any{
				"aspect_ratio": "16:9", "reference_images": []any{"https://cdn.example/frame.jpg"},
			}},
			wantSeconds: 5, wantSize: "2K", wantAction: "image_to_video", wantImages: true,
		},
		{
			name: "comic model", publicModel: "MiniMax-H3-漫剧优化", upstreamModel: "MiniMax-H3-漫剧优化",
			request:     map[string]any{"model": "MiniMax-H3-漫剧优化", "prompt": "comic", "seconds": 5, "size": "4K", "aspect_ratio": "16:9"},
			wantSeconds: 5, wantSize: "4K", wantAction: "text_to_video",
		},
		{
			name: "quantized model", publicModel: "MiniMax-H3-量化版", upstreamModel: "MiniMax-H3-量化版",
			request:     map[string]any{"model": "MiniMax-H3-量化版", "prompt": "quantized", "seconds": 10, "resolution": "768", "aspect_ratio": "9:16"},
			wantSeconds: 10, wantSize: "768", wantAction: "text_to_video",
		},
		{
			name: "four-step model", publicModel: "MiniMax-H3-四步采样版", upstreamModel: "MiniMax-H3-四步采样版",
			request:     map[string]any{"model": "MiniMax-H3-四步采样版", "prompt": "four-step", "seconds": 15, "size": "1080p", "aspect_ratio": "21:9"},
			wantSeconds: 15, wantSize: "1080p", wantAction: "text_to_video",
		},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			descriptor := promptHubsHook(t, plugin, "buildSubmitRequest", promptHubsSubmitContext(testCase.publicModel, testCase.upstreamModel, testCase.request))
			assert.Equal(t, "https://console.prompt-hubs.example/v1/videos", descriptor["url"])
			assert.Equal(t, "POST", descriptor["method"])
			assert.Equal(t, testCase.wantAction, descriptor["action"])
			body := promptHubsObject(t, descriptor["body"])
			assert.Equal(t, testCase.upstreamModel, body["model"])
			assert.Equal(t, testCase.wantSeconds, body["duration_seconds"])
			assert.Equal(t, testCase.wantSize, body["resolution"])
			assert.NotContains(t, body, "duration")
			assert.NotContains(t, body, "content")
			assert.NotContains(t, body, "ratio")
			assert.NotContains(t, body, "metadata")
			assert.Equal(t, testCase.wantImages, body["reference_images"] != nil)
		})
	}

	t.Run("mapped public alias keeps the public model out of the upstream body", func(t *testing.T) {
		descriptor := promptHubsHook(t, plugin, "buildSubmitRequest", promptHubsSubmitContext("skye-h3", "minimax_h3", map[string]any{
			"model": "skye-h3", "prompt": "mapped", "seconds": 5, "size": "768",
		}))
		body := promptHubsObject(t, descriptor["body"])
		assert.Equal(t, "minimax_h3", body["model"])
		assert.NotEqual(t, "skye-h3", body["model"])
	})
}

func TestPromptHubsRejectsInvalidRequestsBeforeSubmit(t *testing.T) {
	plugin := loadPromptHubsPlugin(t)
	testCases := []struct {
		name    string
		model   string
		request map[string]any
		wantErr string
	}{
		{"H3 duration below range", "minimax_h3", map[string]any{"prompt": "p", "seconds": 3}, "seconds must be an integer between 4 and 15"},
		{"H3 unsupported resolution", "minimax_h3", map[string]any{"prompt": "p", "size": "512P"}, "resolution must be one of 768, 1080p, 2K, 4K"},
		{"H3 2K needs a reference", "minimax_h3", map[string]any{"prompt": "p", "size": "2K"}, "2K requires at least one reference media URL"},
		{"comic duration above range", "MiniMax-H3-漫剧优化", map[string]any{"prompt": "p", "seconds": 16}, "seconds must be an integer between 4 and 15"},
		{"comic unsupported resolution", "MiniMax-H3-漫剧优化", map[string]any{"prompt": "p", "size": "1080p"}, "resolution must be one of 768, 2K, 4K"},
		{"quantized duration above range", "MiniMax-H3-量化版", map[string]any{"prompt": "p", "seconds": 11}, "seconds must be an integer between 4 and 10"},
		{"quantized unsupported resolution", "MiniMax-H3-量化版", map[string]any{"prompt": "p", "size": "2K"}, "resolution must be one of 768"},
		{"four-step duration above range", "MiniMax-H3-四步采样版", map[string]any{"prompt": "p", "seconds": 16}, "seconds must be an integer between 4 and 15"},
		{"four-step unsupported resolution", "MiniMax-H3-四步采样版", map[string]any{"prompt": "p", "size": "4K"}, "resolution must be one of 768, 1080p"},
		{"unsupported ratio alias", "minimax_h3", map[string]any{"prompt": "p", "ratio": "16:9"}, "does not support ratio"},
		{"unsupported aspect ratio", "minimax_h3", map[string]any{"prompt": "p", "aspect_ratio": "16:10"}, "aspect_ratio must be one of"},
		{"too many reference images", "minimax_h3", map[string]any{"prompt": "p", "reference_images": promptHubsURLs(10, "image")}, "at most 9 reference images"},
		{"invalid reference URL", "minimax_h3", map[string]any{"prompt": "p", "reference_images": []any{"file:///tmp/frame.png"}}, "must contain public HTTP(S) URLs"},
		{"local reference URL", "minimax_h3", map[string]any{"prompt": "p", "reference_images": []any{"http://127.0.0.1/frame.png"}}, "must contain public HTTP(S) URLs"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", promptHubsSubmitContext(testCase.model, testCase.model, testCase.request))
			require.ErrorContains(t, err, testCase.wantErr)
		})
	}
}

func TestPromptHubsProtocolDecoders(t *testing.T) {
	plugin := loadPromptHubsPlugin(t)

	t.Run("OpenAI video normalizes JSON request aliases", func(t *testing.T) {
		value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "minimax_h3", "upstreamModel": "minimax_h3",
			"body": map[string]any{"kind": "json", "value": map[string]any{
				"model": "minimax_h3", "prompt": "water", "seconds": 5, "resolution": "2K", "aspect_ratio": "16:9",
				"referenceImages": []any{"https://cdn.example/frame.jpg"},
			}},
		})
		require.NoError(t, err)
		intent := promptHubsObject(t, value)
		assert.Equal(t, "minimax_h3", intent["model"])
		assert.Equal(t, "image_to_video", intent["action"])
		request := promptHubsObject(t, intent["requestBody"])
		assert.Equal(t, float64(5), request["duration"])
		assert.Equal(t, "2K", request["size"])
		metadata := promptHubsObject(t, request["metadata"])
		assert.Equal(t, "16:9", metadata["aspect_ratio"])
		assert.Equal(t, []any{"https://cdn.example/frame.jpg"}, metadata["reference_images"])
	})

	t.Run("OpenAI video accepts only URL multipart reference fields", func(t *testing.T) {
		value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "minimax_h3", "upstreamModel": "minimax_h3",
			"body": map[string]any{"kind": "multipart", "fields": map[string]any{
				"model": []any{"minimax_h3"}, "prompt": []any{"water"}, "seconds": []any{"5"}, "size": []any{"2K"},
				"reference_images": []any{"https://cdn.example/frame.jpg"},
			}, "files": []any{}},
		})
		require.NoError(t, err)
		intent := promptHubsObject(t, value)
		request := promptHubsObject(t, intent["requestBody"])
		assert.Equal(t, float64(5), request["duration"])

		_, err = plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "minimax_h3", "upstreamModel": "minimax_h3",
			"body": map[string]any{"kind": "multipart", "fields": map[string]any{"model": []any{"minimax_h3"}, "prompt": []any{"water"}}, "files": []any{
				map[string]any{"field": "reference_images", "ref": "request_file:reference_images"},
			}},
		})
		require.ErrorContains(t, err, "requires reference media to be public HTTP(S) URLs")
	})

	t.Run("Responses multimodal input preserves the public alias and sends the upstream model", func(t *testing.T) {
		value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_responses", "decodeRequest"}, map[string]any{
			"model": "skye-h3", "upstreamModel": "minimax_h3", "stream": false,
			"body": map[string]any{"kind": "json", "value": map[string]any{
				"model": "skye-h3", "seconds": 5, "size": "2K", "input": []any{map[string]any{"role": "user", "content": []any{
					map[string]any{"type": "input_text", "text": "a calm river"},
					map[string]any{"type": "input_image", "image_url": "https://cdn.example/reference.jpg"},
				}}},
			}},
		})
		require.NoError(t, err)
		intent := promptHubsObject(t, value)
		assert.Equal(t, "skye-h3", intent["model"])
		request := promptHubsObject(t, intent["requestBody"])
		descriptor := promptHubsHook(t, plugin, "buildSubmitRequest", promptHubsSubmitContext("skye-h3", "minimax_h3", request))
		body := promptHubsObject(t, descriptor["body"])
		assert.Equal(t, "minimax_h3", body["model"])
		assert.Equal(t, []any{"https://cdn.example/reference.jpg"}, body["reference_images"])
	})

	t.Run("Responses rejects a malformed input value", func(t *testing.T) {
		_, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_responses", "decodeRequest"}, map[string]any{
			"model": "minimax_h3", "body": map[string]any{"kind": "json", "value": map[string]any{"model": "minimax_h3", "input": map[string]any{"text": "bad"}}},
		})
		require.ErrorContains(t, err, "input must be a string or array")
	})
}

func TestPromptHubsSubmitAndPollResponses(t *testing.T) {
	plugin := loadPromptHubsPlugin(t)

	for _, body := range []map[string]any{{"id": "task-id"}, {"task_id": "task-id"}} {
		parsed := promptHubsHook(t, plugin, "parseSubmitResponse", map[string]any{}, map[string]any{"body": body})
		assert.Equal(t, "task-id", parsed["taskId"])
	}
	for _, value := range []any{"<html>gateway page</html>", map[string]any{}, map[string]any{"message": "invalid parameter"}} {
		_, err := plugin.Engine.Call(t.Context(), "parseSubmitResponse", map[string]any{}, map[string]any{"body": value})
		require.Error(t, err)
		assert.NotContains(t, err.Error(), "missing task_id")
	}

	query := promptHubsHook(t, plugin, "buildQueryRequest", map[string]any{
		"baseUrl": "https://console.prompt-hubs.example/", "apiKey": "test-provider-key", "taskId": "task/a",
	})
	assert.Equal(t, "https://console.prompt-hubs.example/v1/videos/task%2Fa", query["url"])
	assert.Equal(t, "GET", query["method"])

	testCases := []struct {
		name       string
		body       map[string]any
		wantStatus string
		wantURL    string
		wantReason string
	}{
		{"queued preserves progress", map[string]any{"status": "queued", "progress": 25}, "IN_PROGRESS", "", ""},
		{"processing", map[string]any{"status": "processing"}, "IN_PROGRESS", "", ""},
		{"running", map[string]any{"status": "running"}, "IN_PROGRESS", "", ""},
		{"in progress", map[string]any{"status": "in_progress"}, "IN_PROGRESS", "", ""},
		{"video URL", map[string]any{"status": "completed", "video_url": "https://cdn.example/video.mp4"}, "SUCCESS", "https://cdn.example/video.mp4", ""},
		{"result URL", map[string]any{"status": "succeeded", "result_url": "https://cdn.example/result.mp4"}, "SUCCESS", "https://cdn.example/result.mp4", ""},
		{"content URL", map[string]any{"status": "succeeded", "outputs": []any{map[string]any{"content_url": "https://cdn.example/content.mp4"}}}, "SUCCESS", "https://cdn.example/content.mp4", ""},
		{"download URL", map[string]any{"status": "succeeded", "outputs": []any{map[string]any{"download_url": "https://cdn.example/download.mp4"}}}, "SUCCESS", "https://cdn.example/download.mp4", ""},
		{"failed", map[string]any{"status": "failed", "error": map[string]any{"message": "provider failure"}}, "FAILURE", "", "provider failure"},
		{"cancelled", map[string]any{"status": "cancelled"}, "FAILURE", "", "task cancelled"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			result := promptHubsHook(t, plugin, "parseTaskResult", map[string]any{}, testCase.body)
			assert.Equal(t, testCase.wantStatus, result["status"])
			assert.Equal(t, testCase.wantURL, common.Interface2String(result["url"]))
			assert.Equal(t, testCase.wantReason, common.Interface2String(result["reason"]))
		})
	}
}

func TestPromptHubsArtifactsAndUsage(t *testing.T) {
	plugin := loadPromptHubsPlugin(t)
	adaptor := taskplugin.New(plugin)
	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "test-provider-key", ChannelBaseUrl: "https://console.prompt-hubs.example/"}})
	task := &model.Task{
		TaskID: "task-public",
		Status: model.TaskStatusSuccess,
		Data:   []byte(`{"status":"succeeded","video_url":"https://cdn.example/final.mp4?expires=expired&signature=stale"}`),
		PrivateData: model.TaskPrivateData{
			UpstreamTaskID: "provider-task-1",
		},
	}
	artifacts, err := adaptor.ListArtifacts(task)
	require.NoError(t, err)
	assert.Equal(t, []relaychannel.TaskArtifact{{Key: "video", Type: "video", MimeType: "video/mp4"}}, artifacts)

	descriptor, err := adaptor.BuildContentRequest(task, "video", relaychannel.TaskArtifactClientRequest{Method: http.MethodHead})
	require.NoError(t, err)
	require.NotNil(t, descriptor)
	assert.Equal(t, "https://console.prompt-hubs.example/v1/videos/provider-task-1/content", descriptor.URL)
	assert.Equal(t, http.MethodGet, descriptor.Method)
	assert.False(t, descriptor.Credentialless)
	assert.True(t, descriptor.DropCredentialsOnRedirect)
	assert.Equal(t, map[string]string{"Authorization": "Bearer test-provider-key"}, descriptor.Headers)

	request := map[string]any{
		"model": "minimax_h3", "prompt": "river", "seconds": 5, "size": "2K",
		"reference_images": []any{"https://cdn.example/frame.jpg"},
	}
	facts := promptHubsHook(t, plugin, "extractUsage", promptHubsSubmitContext("minimax_h3", "minimax_h3", request))
	assert.Equal(t, map[string]any{"seconds": float64(5), "resolution": "2K"}, facts)
	value, err := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
		"usagePurpose": "billing_ratios", "requestBody": request, "model": "minimax_h3", "upstreamModel": "minimax_h3",
	})
	require.NoError(t, err)
	assert.Nil(t, value)
	value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", nil, nil, map[string]any{"status": "succeeded"})
	require.NoError(t, err)
	assert.Nil(t, value)
}

func TestPromptHubsResponsesProtocol(t *testing.T) {
	testVideoResponsesProtocol(t, videoResponsesTestCase{
		pluginKey: "prompt-hubs",
		model:     "minimax_h3",
		requestBody: map[string]any{
			"model": "minimax_h3", "input": "a paper boat on a river", "seconds": 5, "size": "1080p", "metadata": map[string]any{"aspect_ratio": "16:9"},
		},
		wantAction: "text_to_video",
		wantRequest: map[string]any{
			"model": "minimax_h3", "prompt": "a paper boat on a river", "duration": float64(5), "size": "1080p",
			"metadata": map[string]any{"aspect_ratio": "16:9"},
		},
		wantUsageKeys:  []string{"resolution", "seconds"},
		wantVendorName: "prompt-hubs",
	})
}

func TestPromptHubsHostAdaptorRunsSubmitPollAndArtifact(t *testing.T) {
	var submitCalls int32
	var pollCalls int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/videos":
			assert.Equal(t, http.MethodPost, r.Method)
			assert.Equal(t, "Bearer provider-key", r.Header.Get("Authorization"))
			var body map[string]any
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			assert.Equal(t, "minimax_h3", body["model"])
			assert.Equal(t, float64(5), body["duration_seconds"])
			assert.Equal(t, "768", body["resolution"])
			assert.Equal(t, "16:9", body["aspect_ratio"])
			atomic.AddInt32(&submitCalls, 1)
			_, _ = io.WriteString(w, `{"id":"provider-task-1"}`)
		case "/v1/videos/provider-task-1":
			assert.Equal(t, http.MethodGet, r.Method)
			assert.Equal(t, "Bearer provider-key", r.Header.Get("Authorization"))
			if atomic.AddInt32(&pollCalls, 1) == 1 {
				_, _ = io.WriteString(w, `{"status":"processing","progress":45}`)
				return
			}
			_, _ = io.WriteString(w, `{"status":"completed","outputs":[{"content_url":"`+server.URL+`/media.mp4"}]}`)
		case "/v1/videos/provider-task-1/content":
			assert.Equal(t, http.MethodGet, r.Method)
			assert.Equal(t, "Bearer provider-key", r.Header.Get("Authorization"))
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = io.WriteString(w, "video-fixture")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	service.InitHttpClient()

	plugin := loadPromptHubsPlugin(t)
	adaptor := taskplugin.New(plugin)
	info := &relaycommon.RelayInfo{
		OriginModelName: "MiniMax-H3",
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:            "provider-key",
			ChannelBaseUrl:    server.URL,
			UpstreamModelName: "minimax_h3",
		},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{PublicTaskID: "task-public-1"},
	}
	adaptor.Init(info)

	invalidContext := promptHubsHTTPContext(t, map[string]any{
		"model": "MiniMax-H3", "prompt": "river", "seconds": 3, "size": "768",
	})
	invalidTaskErr := adaptor.ValidateRequestAndSetAction(invalidContext, info)
	require.NotNil(t, invalidTaskErr)
	assert.Equal(t, "plugin_request_invalid", invalidTaskErr.Code)
	assert.Contains(t, invalidTaskErr.Message, "between 4 and 15")
	assert.Zero(t, atomic.LoadInt32(&submitCalls))

	request := map[string]any{
		"model": "MiniMax-H3", "prompt": "A paper boat on a river at dawn.",
		"seconds": 5, "size": "768", "aspect_ratio": "16:9",
	}
	c := promptHubsHTTPContext(t, request)
	require.Nil(t, adaptor.ValidateRequestAndSetAction(c, info))

	facts, err := adaptor.ExtractUsageFactsValidated(c, info)
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"seconds": float64(5), "resolution": "768"}, facts)

	body, err := adaptor.BuildRequestBody(c, info)
	require.NoError(t, err)
	response, err := adaptor.DoRequest(c, info, body)
	require.NoError(t, err)
	submitResult, taskErr := adaptor.ParseResponse(c, response, info)
	require.Nil(t, taskErr)
	require.NotNil(t, submitResult)
	assert.Equal(t, "provider-task-1", submitResult.UpstreamTaskID)
	assert.Equal(t, int32(1), atomic.LoadInt32(&submitCalls))

	task := &model.Task{
		TaskID: "task-public-1",
		Status: model.TaskStatusInProgress,
		Data:   submitResult.TaskData,
		Properties: model.Properties{
			OriginModelName:   "MiniMax-H3",
			UpstreamModelName: "minimax_h3",
		},
		PrivateData: model.TaskPrivateData{UpstreamTaskID: submitResult.UpstreamTaskID},
	}

	pollResponse, err := adaptor.FetchTask(server.URL, "provider-key", task, "")
	require.NoError(t, err)
	pollBody, err := io.ReadAll(pollResponse.Body)
	require.NoError(t, pollResponse.Body.Close())
	pollResult, err := adaptor.ParseTaskResult(task, pollResponse, pollBody)
	require.NoError(t, err)
	assert.Equal(t, "IN_PROGRESS", pollResult.Status)

	pollResponse, err = adaptor.FetchTask(server.URL, "provider-key", task, "")
	require.NoError(t, err)
	pollBody, err = io.ReadAll(pollResponse.Body)
	require.NoError(t, pollResponse.Body.Close())
	pollResult, err = adaptor.ParseTaskResult(task, pollResponse, pollBody)
	require.NoError(t, err)
	require.Equal(t, string(model.TaskStatusSuccess), pollResult.Status)
	task.Status = model.TaskStatusSuccess
	task.Data = pollBody

	artifacts, err := adaptor.ListArtifacts(task)
	require.NoError(t, err)
	require.Equal(t, []relaychannel.TaskArtifact{{Key: "video", Type: "video", MimeType: "video/mp4"}}, artifacts)
	content, err := adaptor.BuildContentRequest(task, "video", relaychannel.TaskArtifactClientRequest{Method: http.MethodGet})
	require.NoError(t, err)
	require.NotNil(t, content)
	assert.False(t, content.Credentialless)
	assert.Equal(t, map[string]string{"Authorization": "Bearer provider-key"}, content.Headers)
	contentRequest, err := http.NewRequest(http.MethodGet, content.URL, nil)
	require.NoError(t, err)
	for name, value := range content.Headers {
		contentRequest.Header.Set(name, value)
	}
	contentResponse, err := http.DefaultClient.Do(contentRequest)
	require.NoError(t, err)
	contentBody, err := io.ReadAll(contentResponse.Body)
	require.NoError(t, contentResponse.Body.Close())
	assert.Equal(t, "video-fixture", string(contentBody))
	assert.Equal(t, int32(2), atomic.LoadInt32(&pollCalls))
}

func promptHubsHTTPContext(t *testing.T, request map[string]any) *gin.Context {
	t.Helper()
	body, err := json.Marshal(request)
	require.NoError(t, err)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("task_request", request)
	return c
}
