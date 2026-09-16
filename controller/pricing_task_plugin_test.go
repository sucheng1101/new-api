package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const pricingPublicContractPluginSource = `
export const meta = {
  apiVersion: 1,
  key: "pricing-public-contract-probe",
  name: "Pricing Public Contract Probe",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["pricing-public-contract-video"],
  fetchMode: "per_task",
  usageProfiles: [{
    models: ["pricing-public-contract-video"],
    schema: {
      seconds: {type: "number", unit: "second"},
      resolution: {enum: ["768P", "2K"]}
    },
    examples: [{label: "5 seconds 2K", facts: {seconds: 5, resolution: "2K"}}]
  }]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`

const pricingAddonHailuoPluginSource = `
export const meta = {
  apiVersion: 1,
  key: "pricing-addon-hailuo",
  name: "Pricing Addon Hailuo",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["pricing-addon-video"],
  fetchMode: "per_task",
  usageProfiles: [{
    models: ["pricing-addon-video"],
    schema: {
      seconds: {type: "number", unit: "second"},
      resolution: {enum: ["768", "2K"]},
      input_images: {type: "number", unit: "count"},
      input_video_seconds: {type: "number", unit: "second"}
    },
    examples: [{label: "Hailuo reference", facts: {seconds: 5, resolution: "2K", input_images: 3, input_video_seconds: 8}}]
  }]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`

const pricingAddonPromptHubsPluginSource = `
export const meta = {
  apiVersion: 1,
  key: "pricing-addon-prompt-hubs",
  name: "Pricing Addon Prompt Hubs",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["pricing-addon-video"],
  fetchMode: "per_task",
  usageProfiles: [{
    models: ["pricing-addon-video"],
    schema: {
      seconds: {type: "number", unit: "second"},
      resolution: {enum: ["768", "1080P", "2K", "4K"]}
    },
    examples: [{label: "Prompt Hubs 4K", facts: {seconds: 15, resolution: "4K"}}]
  }]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`

func withTaskPluginAddonBillingConfig(t *testing.T, expressions map[string]string) {
	t.Helper()

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		if key == "billing_setting.plugin_billing_addon_expr" {
			saved[key] = value
		}
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
		model.InvalidatePricingCache()
	})

	encoded, err := common.Marshal(expressions)
	require.NoError(t, err)
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.plugin_billing_addon_expr": string(encoded),
	}))
	model.InvalidatePricingCache()
}

func TestPricingResponseIncludesTaskPluginUsageContract(t *testing.T) {
	taskPluginControllerTestMutex.Lock()
	defer taskPluginControllerTestMutex.Unlock()

	database := setupModelListControllerTestDB(t)
	plugin, err := jsplugin.DefaultRegistry.Register(pricingPublicContractPluginSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = jsplugin.DefaultRegistry.Unregister(plugin.Meta.Key)
		model.InvalidatePricingCache()
	})

	const (
		modelName = "pricing-public-contract-video"
		userID    = 70123
	)
	require.NoError(t, database.Create(&model.Channel{
		Id:     1,
		Type:   35,
		Key:    "pricing-public-contract-key",
		Name:   "Pricing public contract channel",
		Status: common.ChannelStatusEnabled,
		Group:  "default",
		Models: modelName,
	}).Error)
	require.NoError(t, database.Create(&model.Ability{
		Group:     "default",
		Model:     modelName,
		ChannelId: 1,
		Enabled:   true,
	}).Error)
	require.NoError(t, database.Create(&model.User{
		Id:       userID,
		Username: "pricing-public-contract-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	model.InvalidatePricingCache()

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/pricing", nil)
	context.Set("id", userID)
	GetPricing(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool            `json:"success"`
		Data    []model.Pricing `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)

	var pricing *model.Pricing
	for index := range response.Data {
		if response.Data[index].ModelName == modelName {
			pricing = &response.Data[index]
			break
		}
	}
	require.NotNil(t, pricing)
	assert.Equal(t, "second", pricing.BillingUsageSchema["seconds"].Unit)
	assert.Equal(t, []string{"768P", "2K"}, pricing.BillingUsageSchema["resolution"].Enum)
	require.Len(t, pricing.BillingUsageExamples, 1)
	assert.Equal(t, "5 seconds 2K", pricing.BillingUsageExamples[0].Label)
}

func TestPricingResponseSeparatesHailuoAddonFromSharedTaskPrice(t *testing.T) {
	taskPluginControllerTestMutex.Lock()
	defer taskPluginControllerTestMutex.Unlock()

	database := setupModelListControllerTestDB(t)
	hailuo, err := jsplugin.DefaultRegistry.Register(pricingAddonHailuoPluginSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = jsplugin.DefaultRegistry.Unregister(hailuo.Meta.Key)
		model.InvalidatePricingCache()
	})
	promptHubs, err := jsplugin.DefaultRegistry.Register(pricingAddonPromptHubsPluginSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = jsplugin.DefaultRegistry.Unregister(promptHubs.Meta.Key)
		model.InvalidatePricingCache()
	})

	const (
		modelName = "pricing-addon-video"
		userID    = 70124
	)
	baseExpression := `tier("video", u("seconds"))`
	addonExpression := `u("resolution") == "2K" ? tier("2K reference media", u("input_images") * 2 + u("input_video_seconds")) : tier("768 reference media", u("input_images") + u("input_video_seconds"))`
	withTieredBillingConfig(t, map[string]string{modelName: "tiered_expr"}, map[string]string{modelName: baseExpression})
	withTaskPluginAddonBillingConfig(t, map[string]string{
		"pricing-addon-hailuo::" + modelName: addonExpression,
	})

	require.NoError(t, database.Create(&model.Channel{
		Id:     2,
		Type:   35,
		Key:    "pricing-addon-key",
		Name:   "Pricing addon channel",
		Status: common.ChannelStatusEnabled,
		Group:  "default",
		Models: modelName,
	}).Error)
	require.NoError(t, database.Create(&model.Ability{
		Group:     "default",
		Model:     modelName,
		ChannelId: 2,
		Enabled:   true,
	}).Error)
	require.NoError(t, database.Create(&model.User{
		Id:       userID,
		Username: "pricing-addon-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	model.InvalidatePricingCache()

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/pricing", nil)
	context.Set("id", userID)
	GetPricing(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool            `json:"success"`
		Data    []model.Pricing `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)

	var pricing *model.Pricing
	for index := range response.Data {
		if response.Data[index].ModelName == modelName {
			pricing = &response.Data[index]
			break
		}
	}
	require.NotNil(t, pricing)
	assert.Equal(t, baseExpression, pricing.BillingExpr)
	assert.Contains(t, pricing.BillingUsageSchema, "seconds")
	assert.Contains(t, pricing.BillingUsageSchema, "resolution")
	assert.NotContains(t, pricing.BillingUsageSchema, "input_images")
	assert.NotContains(t, pricing.BillingUsageSchema, "input_video_seconds")

	require.Len(t, pricing.BillingPluginAddons, 1)
	addon := pricing.BillingPluginAddons[0]
	assert.Equal(t, "pricing-addon-hailuo", addon.PluginKey)
	assert.Equal(t, addonExpression, addon.BillingExpr)
	assert.Contains(t, addon.UsageSchema, "input_images")
	assert.Contains(t, addon.UsageSchema, "input_video_seconds")
	assert.NotContains(t, addon.UsageSchema, "seconds")
	assert.Equal(t, []string{"768", "2K"}, addon.UsageSchema["resolution"].Enum)
}
