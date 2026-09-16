package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskBillingSummaryProjectsUsageAndComponentsWithoutExpressions(t *testing.T) {
	task := &model.Task{
		Quota:  720000,
		Status: model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			BillingContext: &model.TaskBillingContext{TieredSnapshot: &billingexpr.BillingSnapshot{
				BillingMode:              "tiered_expr",
				GroupRatio:               1.2,
				EstimatedQuotaAfterGroup: 600000,
				ExprString:               `tier("private", u("seconds"))`,
				UsageFacts:               map[string]any{"seconds": 5, "resolution": "2K", "input_images": 2},
				Components: []billingexpr.BillingComponentSnapshot{
					{Kind: "base", EstimatedQuotaBeforeGroup: 400000, EstimatedTier: "2K", ActualQuotaBeforeGroup: 450000, ActualTier: "2K"},
					{Kind: "plugin_addon", PluginKey: "hailuo", EstimatedQuotaBeforeGroup: 100000, EstimatedTier: "reference_media", ActualQuotaBeforeGroup: 150000, ActualTier: "reference_media"},
				},
			}},
		},
	}

	summary := taskBillingSummary(task)
	require.NotNil(t, summary)
	assert.Equal(t, "tiered_expr", summary.Mode)
	assert.Equal(t, 1.2, summary.GroupRatio)
	assert.Equal(t, 600000, summary.EstimatedQuota)
	assert.Equal(t, 720000, summary.ActualQuota)
	assert.True(t, summary.Settled)
	assert.Equal(t, map[string]any{"seconds": 5, "resolution": "2K", "input_images": 2}, summary.UsageFacts)
	require.Len(t, summary.Components, 2)
	assert.Equal(t, "base", summary.Components[0].Kind)
	assert.Equal(t, "hailuo", summary.Components[1].PluginKey)
	assert.NotContains(t, summary.UsageFacts, "expr_string")
}
