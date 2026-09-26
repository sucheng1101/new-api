package model

import (
	"testing"

	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const pricingSnapshotProbeSource = `
export const meta = {
  apiVersion: 1,
  key: "pricing-snapshot-probe",
  name: "Pricing Snapshot Probe",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["pricing-video"],
  fetchMode: "per_task",
  usageSchema: {fallback: {type: "number", unit: "count"}},
  usageProfiles: [{
    models: ["pricing-video"],
    schema: {
      seconds: {type: "number", unit: "second"},
      resolution: {enum: ["768P", "2K"]},
      input_images: {type: "number", unit: "count"},
      input_video_seconds: {type: "number", unit: "second"}
    },
    examples: [{label: "5 seconds", facts: {seconds: 5, resolution: "768P", input_images: 0, input_video_seconds: 0}}]
  }]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`

const pricingSnapshotSecondaryProbeSource = `
export const meta = {
  apiVersion: 1,
  key: "pricing-snapshot-secondary",
  name: "Pricing Snapshot Secondary",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["pricing-contract-video"],
  fetchMode: "per_task",
  usageProfiles: [{
    models: ["pricing-contract-video"],
    schema: {
      seconds: {type: "number", unit: "second"},
      resolution: {enum: ["1080P", "4K"]}
    },
    examples: [{label: "5 seconds 4K", facts: {seconds: 5, resolution: "4K"}}]
  }]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`

const pricingSnapshotPrimaryProbeSource = `
export const meta = {
  apiVersion: 1,
  key: "pricing-snapshot-primary",
  name: "Pricing Snapshot Primary",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["pricing-contract-video"],
  fetchMode: "per_task",
  usageProfiles: [{
    models: ["pricing-contract-video"],
    schema: {
      seconds: {type: "number", unit: "second"},
      resolution: {enum: ["768P", "2K"]}
    },
    examples: [{label: "5 seconds 768P", facts: {seconds: 5, resolution: "768P"}}]
  }]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`

const pricingSnapshotSharedHailuoProbeSource = `
export const meta = {
  apiVersion: 1,
  key: "pricing-shared-hailuo",
  name: "Pricing Shared Hailuo",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["pricing-shared-video"],
  fetchMode: "per_task",
  usageProfiles: [{
    models: ["pricing-shared-video"],
    schema: {
      seconds: {type: "number", unit: "second"},
      resolution: {enum: ["768", "2K"], enumLabels: {"768": {en: "768P", zh: "768P"}, "2K": {en: "2K", zh: "2K"}}},
      input_images: {type: "number", unit: "count"},
      input_video_seconds: {type: "number", unit: "second"}
    },
    examples: [
      {label: "Hailuo 768P", facts: {seconds: 5, resolution: "768", input_images: 0, input_video_seconds: 0}},
      {label: "Hailuo reference", facts: {seconds: 5, resolution: "2K", input_images: 3, input_video_seconds: 0}}
    ]
  }]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`

const pricingSnapshotSharedPromptHubsProbeSource = `
export const meta = {
  apiVersion: 1,
  key: "pricing-shared-prompt-hubs",
  name: "Pricing Shared Prompt Hubs",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["pricing-shared-video"],
  fetchMode: "per_task",
  usageProfiles: [{
    models: ["pricing-shared-video"],
    schema: {
      seconds: {type: "number", unit: "second"},
      resolution: {enum: ["768", "1080p", "2K", "4K"], enumLabels: {"768": {en: "768P", zh: "768P"}, "1080p": {en: "1080p", zh: "1080p"}, "4K": {en: "4K", zh: "4K"}}}
    },
    examples: [{label: "Prompt Hubs 4K", facts: {seconds: 15, resolution: "4K"}}]
  }]
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`

func TestModelPricingSnapshotValidatesUsageAndVersionConflicts(t *testing.T) {
	previousDB := DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Option{}))
	DB = database
	initCol()
	t.Cleanup(func() { DB = previousDB })

	plugin, err := jsplugin.DefaultRegistry.Register(pricingSnapshotProbeSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(plugin.Meta.Key) })

	snapshot, err := GetModelPricingSnapshot([]string{"pricing-video"})
	require.NoError(t, err)
	require.Len(t, snapshot.Entries, 1)
	entry := snapshot.Entries[0]
	assert.Equal(t, []string{"768P", "2K"}, entry.UsageSchema["resolution"].Enum)
	require.Len(t, entry.UsageExamples, 1)
	assert.Equal(t, "5 seconds", entry.UsageExamples[0].Label)
	schema, _ := plugin.Meta.UsageForModel("pricing-video")
	assert.Len(t, schema, 4)

	expression := `tier("video", u("resolution") == "2K" ? u("seconds") * 30 + u("input_images") * 7 + u("input_video_seconds") * 5 : u("seconds") * 10 + u("input_images") * 7 + u("input_video_seconds") * 5)`
	require.NoError(t, ValidateModelPricing("pricing-video", PricingValues{
		"billing_setting.billing_mode": "tiered_expr",
		"billing_setting.billing_expr": expression,
	}))
	assert.ErrorContains(t, ValidateModelPricing("pricing-video", PricingValues{
		"billing_setting.billing_mode": "tiered_expr",
		"billing_setting.billing_expr": `tier("video", u("undeclared_usage"))`,
	}), "not declared")

	change := ModelPricingChange{
		ModelName:       "pricing-video",
		ExpectedVersion: entry.Version,
		Pricing: PricingValues{
			"billing_setting.billing_mode": "tiered_expr",
			"billing_setting.billing_expr": expression,
		},
	}
	require.NoError(t, UpdateModelPricing([]ModelPricingChange{change}))

	updated, err := GetModelPricingSnapshot([]string{"pricing-video"})
	require.NoError(t, err)
	require.Equal(t, expression, updated.Entries[0].Configured["billing_setting.billing_expr"])
	assert.NotEqual(t, entry.Version, updated.Entries[0].Version)

	stale := change
	stale.Pricing["billing_setting.billing_expr"] = `tier("stale", u("seconds"))`
	assert.ErrorIs(t, UpdateModelPricing([]ModelPricingChange{stale}), ErrModelPricingConflict)
	unchanged, err := GetModelPricingSnapshot([]string{"pricing-video"})
	require.NoError(t, err)
	assert.Equal(t, expression, unchanged.Entries[0].Configured["billing_setting.billing_expr"])
}

func TestLegacyModelPricingOptionUsesSnapshotValidation(t *testing.T) {
	previousDB := DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Option{}))
	DB = database
	initCol()
	t.Cleanup(func() { DB = previousDB })

	plugin, err := jsplugin.DefaultRegistry.Register(pricingSnapshotProbeSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(plugin.Meta.Key) })

	valid := `{"pricing-video":"tier(\"video\", u(\"seconds\"))"}`
	require.NoError(t, UpdateOption("billing_setting.billing_expr", valid))
	assert.Error(t, UpdateOption("billing_setting.billing_expr", `{"pricing-video":"tier(\"video\", u(\"missing\"))"}`))
}

func TestModelPricingUsesOneContractAndPreservesLegacyPluginOverrides(t *testing.T) {
	previousDB := DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Option{}))
	DB = database
	initCol()
	t.Cleanup(func() { DB = previousDB })

	primary, err := jsplugin.DefaultRegistry.Register(pricingSnapshotPrimaryProbeSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(primary.Meta.Key) })
	secondary, err := jsplugin.DefaultRegistry.Register(pricingSnapshotSecondaryProbeSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(secondary.Meta.Key) })

	legacyValue := `{"pricing-snapshot-primary::pricing-contract-video":"tier(\"legacy\", u(\"seconds\"))"}`
	require.NoError(t, database.Create(&Option{
		Key:   billing_setting.PluginBillingExprOption,
		Value: legacyValue,
	}).Error)

	snapshot, err := GetModelPricingSnapshot([]string{"pricing-contract-video"})
	require.NoError(t, err)
	require.Len(t, snapshot.Entries, 1)
	entry := snapshot.Entries[0]
	assert.Equal(t, []string{"768P", "2K", "1080P", "4K"}, entry.UsageSchema["resolution"].Enum)
	assert.Len(t, entry.UsageExamples, 2)
	assert.NotContains(t, entry.Configured, billing_setting.PluginBillingExprOption)
	assert.NotContains(t, snapshot.Options, billing_setting.PluginBillingExprOption)

	expression := `tier("public", u("seconds") * 10)`
	require.NoError(t, UpdateModelPricing([]ModelPricingChange{{
		ModelName:       entry.ModelName,
		ExpectedVersion: entry.Version,
		Pricing: PricingValues{
			"billing_setting.billing_mode": "tiered_expr",
			"billing_setting.billing_expr": expression,
		},
	}}))

	var legacy Option
	require.NoError(t, database.Where(commonKeyCol+" = ?", billing_setting.PluginBillingExprOption).First(&legacy).Error)
	assert.Equal(t, legacyValue, legacy.Value)
}

func TestModelPricingSharedContractUsesPluginAddonExpressions(t *testing.T) {
	previousDB := DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Option{}))
	DB = database
	initCol()
	t.Cleanup(func() { DB = previousDB })

	hailuo, err := jsplugin.DefaultRegistry.Register(pricingSnapshotSharedHailuoProbeSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(hailuo.Meta.Key) })
	promptHubs, err := jsplugin.DefaultRegistry.Register(pricingSnapshotSharedPromptHubsProbeSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(promptHubs.Meta.Key) })

	snapshot, err := GetModelPricingSnapshot([]string{"pricing-shared-video"})
	require.NoError(t, err)
	require.Len(t, snapshot.Entries, 1)
	entry := snapshot.Entries[0]
	assert.Len(t, entry.UsageSchema, 2)
	assert.Contains(t, entry.UsageSchema, "seconds")
	assert.Contains(t, entry.UsageSchema, "resolution")
	assert.NotContains(t, entry.UsageSchema, "input_images")
	assert.NotContains(t, entry.UsageSchema, "input_video_seconds")
	assert.Equal(t, []string{"768", "2K", "1080p", "4K"}, entry.UsageSchema["resolution"].Enum)
	assert.Equal(t, "4K", entry.UsageSchema["resolution"].EnumLabels["4K"]["zh"])
	require.Len(t, entry.UsageExamples, 1)
	assert.Equal(t, "Prompt Hubs 4K", entry.UsageExamples[0].Label)
	require.Len(t, entry.PluginAddons, 2)
	assert.Equal(t, "pricing-shared-hailuo", entry.PluginAddons[0].PluginKey)
	assert.Equal(t, []string{"768", "2K"}, entry.PluginAddons[0].UsageSchema["resolution"].Enum)
	assert.Contains(t, entry.PluginAddons[0].UsageSchema, "input_images")
	assert.Contains(t, entry.PluginAddons[0].UsageSchema, "input_video_seconds")
	assert.Equal(t, "pricing-shared-prompt-hubs", entry.PluginAddons[1].PluginKey)
	assert.NotContains(t, entry.PluginAddons[1].UsageSchema, "input_images")

	err = ValidateModelPricing("pricing-shared-video", PricingValues{
		"billing_setting.billing_mode": "tiered_expr",
		"billing_setting.billing_expr": `tier("unsupported", u("input_images"))`,
	})
	assert.ErrorContains(t, err, `usage key "input_images" is not declared`)

	baseExpr := `u("resolution") == "4K" ? tier("4K", u("seconds") * 4) : tier("base", u("seconds"))`
	addonExpr := `u("resolution") == "2K" ? tier("2K reference media", u("input_images") * 7 + u("input_video_seconds") * 5) : tier("768 reference media", u("input_images") * 3 + u("input_video_seconds") * 2)`
	pricing := PricingValues{
		"billing_setting.billing_mode": "tiered_expr",
		"billing_setting.billing_expr": baseExpr,
		billing_setting.PluginBillingAddonExprOption: map[string]any{
			"pricing-shared-hailuo": addonExpr,
		},
	}
	require.NoError(t, ValidateModelPricing("pricing-shared-video", pricing))

	err = ValidateModelPricing("pricing-shared-video", PricingValues{
		"billing_setting.billing_mode": "tiered_expr",
		"billing_setting.billing_expr": baseExpr,
		billing_setting.PluginBillingAddonExprOption: map[string]any{
			"pricing-shared-prompt-hubs": addonExpr,
		},
	})
	assert.ErrorContains(t, err, "has no plugin-specific usage facts")

	require.NoError(t, UpdateModelPricing([]ModelPricingChange{{
		ModelName:       entry.ModelName,
		ExpectedVersion: entry.Version,
		Pricing:         pricing,
	}}))
	updated, err := GetModelPricingSnapshot([]string{"pricing-shared-video"})
	require.NoError(t, err)
	require.Len(t, updated.Entries, 1)
	configured, ok := updated.Entries[0].Configured[billing_setting.PluginBillingAddonExprOption].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, addonExpr, configured["pricing-shared-hailuo"])
	assert.Len(t, updated.Entries[0].PluginAddons[0].UsageSchema, 3)
	assert.Equal(t, []string{"768", "2K"}, updated.Entries[0].PluginAddons[0].UsageSchema["resolution"].Enum)
	assert.Contains(t, updated.Entries[0].PluginAddons[0].UsageSchema, "input_images")
	assert.Contains(t, updated.Entries[0].PluginAddons[0].UsageSchema, "input_video_seconds")
	assert.Empty(t, updated.Entries[0].PluginAddons[1].UsageSchema)

	allModels, err := GetModelPricingSnapshot(nil)
	require.NoError(t, err)
	allNames := make([]string, 0, len(allModels.Entries))
	for _, item := range allModels.Entries {
		allNames = append(allNames, item.ModelName)
	}
	assert.Contains(t, allNames, "pricing-shared-video")
	assert.NotContains(t, allNames, "pricing-shared-hailuo::pricing-shared-video")
}
