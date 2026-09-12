package model

import (
	"testing"

	"github.com/QuantumNous/new-api/pkg/jsplugin"
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
