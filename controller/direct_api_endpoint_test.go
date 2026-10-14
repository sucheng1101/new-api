package controller

import (
	"bytes"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http/httptest"
)

func setupDirectAPIEndpointControllerTest(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.Option{}))
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{"DirectAPIEndpoints": "[]"}
	common.OptionMapRWMutex.Unlock()
	model.DB = database
	t.Cleanup(func() {
		model.DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
}

func endpointContext(method, path string, payload []byte) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, path, bytes.NewReader(payload))
	return context, recorder
}

func TestDirectAPIEndpointCRUDHandlers(t *testing.T) {
	setupDirectAPIEndpointControllerTest(t)

	listContext, listRecorder := endpointContext("GET", "/api/admin/security/direct-api-endpoints", nil)
	ListDirectAPIEndpoints(listContext)
	var listResponse struct {
		Success bool                       `json:"success"`
		Data    []common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(listRecorder.Body.Bytes(), &listResponse))
	require.True(t, listResponse.Success)
	require.Empty(t, listResponse.Data)

	createContext, createRecorder := endpointContext("POST", "/api/admin/security/direct-api-endpoints", []byte(`{"name":"Primary","endpoint":"https://api.example.com/v1/","description":"main","enabled":true,"sort_order":1}`))
	CreateDirectAPIEndpoint(createContext)
	var createResponse struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(createRecorder.Body.Bytes(), &createResponse))
	require.True(t, createResponse.Success)
	require.Equal(t, 1, createResponse.Data.ID)

	putContext, putRecorder := endpointContext("PUT", "/api/admin/security/direct-api-endpoints/1", []byte(`{"name":"Primary Updated","endpoint":"https://api.example.com/v2","description":"updated","enabled":true,"sort_order":2}`))
	putContext.Params = gin.Params{{Key: "id", Value: "1"}}
	UpdateDirectAPIEndpoint(putContext)
	var putResponse struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(putRecorder.Body.Bytes(), &putResponse))
	require.True(t, putResponse.Success)
	require.Equal(t, "Primary Updated", putResponse.Data.Name)
	require.Equal(t, "https://api.example.com/v2", putResponse.Data.Endpoint)

	patchContext, patchRecorder := endpointContext("PATCH", "/api/admin/security/direct-api-endpoints/1", []byte(`{"enabled":false}`))
	patchContext.Params = gin.Params{{Key: "id", Value: "1"}}
	PatchDirectAPIEndpoint(patchContext)
	var patchResponse struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(patchRecorder.Body.Bytes(), &patchResponse))
	require.True(t, patchResponse.Success)
	require.False(t, patchResponse.Data.Enabled)
	require.Equal(t, "https://api.example.com/v2", patchResponse.Data.Endpoint)

	deleteContext, deleteRecorder := endpointContext("DELETE", "/api/admin/security/direct-api-endpoints/1", nil)
	deleteContext.Params = gin.Params{{Key: "id", Value: "1"}}
	DeleteDirectAPIEndpoint(deleteContext)
	var deleteResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(deleteRecorder.Body.Bytes(), &deleteResponse))
	require.True(t, deleteResponse.Success)
	require.Empty(t, common.DirectAPIEndpoints())
}

func TestUpdateDirectAPIConfigPatchPreservesOmittedFields(t *testing.T) {
	setupDirectAPIEndpointControllerTest(t)
	common.OptionMapRWMutex.Lock()
	common.OptionMap["DirectAPIHosts"] = "api.example.com"
	common.OptionMap["DirectAPIBaseURL"] = "https://api.example.com"
	common.OptionMapRWMutex.Unlock()

	context, recorder := endpointContext("PATCH", "/api/admin/security/direct-api-config", []byte(`{"base_url":"https://api2.example.com"}`))
	UpdateDirectAPIConfig(context)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	require.Equal(t, "api.example.com", common.OptionMap["DirectAPIHosts"])
	require.Equal(t, "https://api2.example.com", common.OptionMap["DirectAPIBaseURL"])
}
