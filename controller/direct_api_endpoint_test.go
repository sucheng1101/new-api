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

func TestDirectAPIRecordKindCRUDHandlers(t *testing.T) {
	setupDirectAPIEndpointControllerTest(t)

	hostContext, hostRecorder := endpointContext("POST", "/api/admin/security/direct-api-endpoints", []byte(`{"kind":"host","name":"Primary host","endpoint":"api.example.com","enabled":true,"sort_order":0}`))
	CreateDirectAPIEndpoint(hostContext)
	var hostResponse struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(hostRecorder.Body.Bytes(), &hostResponse))
	require.True(t, hostResponse.Success)
	require.Equal(t, common.DirectAPIRecordKindHost, hostResponse.Data.Kind)
	require.Equal(t, "api.example.com", hostResponse.Data.Endpoint)
	require.NotZero(t, hostResponse.Data.UpdatedAt)

	baseContext, baseRecorder := endpointContext("POST", "/api/admin/security/direct-api-endpoints", []byte(`{"kind":"base_url","endpoint":"https://api.example.com/"}`))
	CreateDirectAPIEndpoint(baseContext)
	var baseResponse struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(baseRecorder.Body.Bytes(), &baseResponse))
	require.True(t, baseResponse.Success)
	require.Equal(t, common.DirectAPIRecordKindBaseURL, baseResponse.Data.Kind)
	require.Equal(t, "https://api.example.com", baseResponse.Data.Endpoint)
	require.Equal(t, "https://api.example.com", baseResponse.Data.Name)

	require.Equal(t, []string{"api.example.com"}, common.DirectAPIHosts())
	require.Equal(t, "https://api.example.com", common.DirectAPIBaseURL())

	listContext, listRecorder := endpointContext("GET", "/api/admin/security/direct-api-endpoints", nil)
	ListDirectAPIEndpoints(listContext)
	var listResponse struct {
		Success bool                       `json:"success"`
		Data    []common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(listRecorder.Body.Bytes(), &listResponse))
	require.Len(t, listResponse.Data, 2)

	patchContext, patchRecorder := endpointContext("PATCH", "/api/admin/security/direct-api-endpoints/1", []byte(`{"enabled":false}`))
	patchContext.Params = gin.Params{{Key: "id", Value: "1"}}
	PatchDirectAPIEndpoint(patchContext)
	var patchResponse struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(patchRecorder.Body.Bytes(), &patchResponse))
	require.True(t, patchResponse.Success)
	require.Empty(t, common.DirectAPIHosts())
	require.True(t, common.DirectAPIEndpoints()[0].UpdatedAt > 0)
}

func TestDirectAPIEndpointPurposeSwitchesAreIndependent(t *testing.T) {
	setupDirectAPIEndpointControllerTest(t)

	createContext, createRecorder := endpointContext("POST", "/api/admin/security/direct-api-endpoints", []byte(`{"kind":"host","name":"Gateway","endpoint":"gw.example.com","show_in_token_management":false,"direct_access_enabled":true}`))
	CreateDirectAPIEndpoint(createContext)
	var createResponse struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(createRecorder.Body.Bytes(), &createResponse))
	require.True(t, createResponse.Success)
	require.Equal(t, []string{"gw.example.com"}, common.DirectAPIHosts())
	require.Empty(t, common.EnabledDirectAPIRecords())

	directContext, directRecorder := endpointContext("PATCH", "/api/admin/security/direct-api-endpoints/1", []byte(`{"direct_access_enabled":false}`))
	directContext.Params = gin.Params{{Key: "id", Value: "1"}}
	PatchDirectAPIEndpoint(directContext)
	var directResponse struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(directRecorder.Body.Bytes(), &directResponse))
	require.True(t, directResponse.Success)
	require.Empty(t, common.DirectAPIHosts())
	require.Empty(t, common.EnabledDirectAPIRecords())

	visibleContext, visibleRecorder := endpointContext("PATCH", "/api/admin/security/direct-api-endpoints/1", []byte(`{"show_in_token_management":true}`))
	visibleContext.Params = gin.Params{{Key: "id", Value: "1"}}
	PatchDirectAPIEndpoint(visibleContext)
	var visibleResponse struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(visibleRecorder.Body.Bytes(), &visibleResponse))
	require.True(t, visibleResponse.Success)
	require.Empty(t, common.DirectAPIHosts())
	require.Len(t, common.EnabledDirectAPIRecords(), 1)
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
	require.Equal(t, []string{"api.example.com"}, common.DirectAPIHosts())
	require.Equal(t, "https://api2.example.com", common.DirectAPIBaseURL())

	var hosts, baseURLs int
	for _, record := range common.DirectAPIEndpoints() {
		switch common.DirectAPIRecordKind(record) {
		case common.DirectAPIRecordKindHost:
			hosts++
		case common.DirectAPIRecordKindBaseURL:
			baseURLs++
		}
	}
	require.Equal(t, 1, hosts)
	require.Equal(t, 1, baseURLs)
}

func TestUpdateDirectAPIConfigCurrentOriginPatchPreservesRecords(t *testing.T) {
	setupDirectAPIEndpointControllerTest(t)
	require.NoError(t, model.UpdateDirectAPIEndpoints([]common.DirectAPIEndpoint{{
		Kind:     common.DirectAPIRecordKindBaseURL,
		Name:     "Primary",
		Endpoint: "https://api.example.com",
		Enabled:  true,
	}}))

	context, recorder := endpointContext("PATCH", "/api/admin/security/direct-api-config", []byte(`{"token_use_current_origin":true}`))
	UpdateDirectAPIConfig(context)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			TokenUseCurrentOrigin bool `json:"token_use_current_origin"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.True(t, response.Data.TokenUseCurrentOrigin)
	require.True(t, common.DirectAPITokenUseCurrentOrigin())
	require.Len(t, common.DirectAPIEndpoints(), 1)
	require.Equal(t, "https://api.example.com", common.DirectAPIEndpoints()[0].Endpoint)

	var option model.Option
	require.NoError(t, model.DB.Where("key = ?", common.DirectAPITokenUseCurrentOriginKey).First(&option).Error)
	require.Equal(t, "true", option.Value)
}

func TestUpdateDirectAPIConfigCurrentOriginSyncsDefaultAddressAtomically(t *testing.T) {
	setupDirectAPIEndpointControllerTest(t)
	require.NoError(t, model.UpdateDirectAPIEndpoints([]common.DirectAPIEndpoint{
		{
			Kind:        common.DirectAPIRecordKindHost,
			Name:        "Gateway host",
			Endpoint:    "gateway.example.com",
			Description: "direct host",
			Enabled:     true,
		},
		{
			Kind:        common.DirectAPIRecordKindBaseURL,
			Name:        "Primary",
			Endpoint:    "https://api.example.com",
			Description: "default address",
			Enabled:     true,
		},
		{
			Kind:        common.DirectAPIRecordKindEndpoint,
			Name:        "OpenAI",
			Endpoint:    "https://openai.example.com/v1",
			Description: "additional endpoint",
			Enabled:     true,
		},
	}))

	context, recorder := endpointContext("PATCH", "/api/admin/security/direct-api-config", []byte(`{"token_use_current_origin":true,"base_url":"http://127.0.0.1:5200"}`))
	UpdateDirectAPIConfig(context)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			TokenUseCurrentOrigin bool                       `json:"token_use_current_origin"`
			Records               []common.DirectAPIEndpoint `json:"records"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.True(t, response.Data.TokenUseCurrentOrigin)
	require.Len(t, response.Data.Records, 3)
	require.True(t, common.DirectAPITokenUseCurrentOrigin())
	require.Equal(t, []string{"gateway.example.com"}, common.DirectAPIHosts())
	require.Equal(t, "http://127.0.0.1:5200", common.DirectAPIBaseURL())

	for _, record := range response.Data.Records {
		switch common.DirectAPIRecordKind(record) {
		case common.DirectAPIRecordKindBaseURL:
			require.Equal(t, "Primary", record.Name)
			require.Equal(t, "http://127.0.0.1:5200", record.Endpoint)
			require.Equal(t, "default address", record.Description)
			require.True(t, record.IsShownInTokenManagement())
		case common.DirectAPIRecordKindEndpoint:
			require.Equal(t, "OpenAI", record.Name)
			require.Equal(t, "https://openai.example.com/v1", record.Endpoint)
		}
	}

	var option model.Option
	require.NoError(t, model.DB.Where("key = ?", common.DirectAPITokenUseCurrentOriginKey).First(&option).Error)
	require.Equal(t, "true", option.Value)
}

func TestUpdateDirectAPIConfigRejectsInvalidCurrentOriginWithoutChangingSettings(t *testing.T) {
	setupDirectAPIEndpointControllerTest(t)
	require.NoError(t, model.UpdateDirectAPIEndpoints([]common.DirectAPIEndpoint{{
		Kind:     common.DirectAPIRecordKindBaseURL,
		Name:     "Primary",
		Endpoint: "https://api.example.com",
		Enabled:  true,
	}}))

	context, recorder := endpointContext("PATCH", "/api/admin/security/direct-api-config", []byte(`{"token_use_current_origin":true,"base_url":"javascript:alert(1)"}`))
	UpdateDirectAPIConfig(context)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.False(t, response.Success)
	require.False(t, common.DirectAPITokenUseCurrentOrigin())
	require.Equal(t, "https://api.example.com", common.DirectAPIEndpoints()[0].Endpoint)

	var option model.Option
	require.Error(t, model.DB.Where("key = ?", common.DirectAPITokenUseCurrentOriginKey).First(&option).Error)
}

func TestEditingDefaultAddressDisablesCurrentOriginPreference(t *testing.T) {
	setupDirectAPIEndpointControllerTest(t)
	require.NoError(t, model.UpdateDirectAPIEndpointsAndTokenOrigin([]common.DirectAPIEndpoint{{
		Kind:     common.DirectAPIRecordKindBaseURL,
		Name:     "Primary",
		Endpoint: "https://entry.example.com",
		Enabled:  true,
	}}, true))

	context, recorder := endpointContext("PATCH", "/api/admin/security/direct-api-endpoints/1", []byte(`{"endpoint":"https://manual.example.com"}`))
	context.Params = gin.Params{{Key: "id", Value: "1"}}
	PatchDirectAPIEndpoint(context)
	var response struct {
		Success bool                     `json:"success"`
		Data    common.DirectAPIEndpoint `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Equal(t, "https://manual.example.com", response.Data.Endpoint)
	require.False(t, common.DirectAPITokenUseCurrentOrigin())

	var option model.Option
	require.NoError(t, model.DB.Where("key = ?", common.DirectAPITokenUseCurrentOriginKey).First(&option).Error)
	require.Equal(t, "false", option.Value)
}
