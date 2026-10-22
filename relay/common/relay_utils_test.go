package common

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	requestcommon "github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestValidateBasicTaskRequestNormalizesImageInputs(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		field string
	}{
		{name: "image", field: "image"},
		{name: "input reference", field: "input_reference"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(
				http.MethodPost,
				"/v1/video/generations",
				strings.NewReader(`{"model":"sora-2","prompt":"animate this frame","`+testCase.field+`":"https://cdn.example/frame.png"}`),
			)
			ctx.Request.Header.Set("Content-Type", "application/json")

			relayInfo := &RelayInfo{TaskRelayInfo: &TaskRelayInfo{}}
			taskErr := ValidateBasicTaskRequest(ctx, relayInfo, constant.TaskActionImageToVideo)
			require.Nil(t, taskErr)

			req, err := GetTaskRequest(ctx)
			require.NoError(t, err)
			require.Equal(t, []string{"https://cdn.example/frame.png"}, req.Images)
			require.True(t, req.HasImage())
			require.Equal(t, constant.TaskActionImageToVideo, relayInfo.Action)

			requestcommon.CleanupBodyStorage(ctx)
		})
	}
}
