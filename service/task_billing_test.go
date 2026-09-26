package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMain(m *testing.M) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		panic("failed to open test db: " + err.Error())
	}
	sqlDB, err := db.DB()
	if err != nil {
		panic("failed to get sql.DB: " + err.Error())
	}
	sqlDB.SetMaxOpenConns(1)

	model.DB = db
	model.LOG_DB = db

	common.UsingSQLite = true // Fork：数据库类型用布尔量标记
	common.UsingPostgreSQL = false
	common.UsingMySQL = false
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false
	common.LogConsumeEnabled = true

	if err := db.AutoMigrate(
		&model.Task{},
		&model.User{},
		&model.Token{},
		&model.Log{},
		&model.Channel{},
		&model.Midjourney{},
		&model.TopUp{},
		&model.UserSubscription{},
		&model.WalletOperation{},
		&model.WalletTransaction{},
		&model.WalletCashLot{},
		&model.WalletConsumptionAllocation{},
		&model.SystemTask{},
		&model.SystemTaskLock{},
		&model.Ability{}, // Skye 渠道账本测试需要
		&model.Option{},
		&model.LotteryDaily{},
		&model.ChannelKeyUsage{},
		&model.ChannelUsageDaily{},
		&model.SystemEventLog{},
		&model.TaskArtifactObject{},
	); err != nil {
		panic("failed to migrate: " + err.Error())
	}

	os.Exit(m.Run())
}

func TestPriceDataOtherRatiosFilterAndSnapshot(t *testing.T) {
	priceData := types.PriceData{}

	priceData.AddOtherRatio("zero", 0)
	priceData.AddOtherRatio("negative", -0.5)
	priceData.AddOtherRatio("nan", math.NaN())
	priceData.AddOtherRatio("inf", math.Inf(1))
	priceData.AddOtherRatio("one", 1)
	priceData.AddOtherRatio("positive", 2.5)

	ratios := priceData.OtherRatios()
	require.Len(t, ratios, 2)
	assert.Equal(t, 1.0, ratios["one"])
	assert.Equal(t, 2.5, ratios["positive"])
	assert.True(t, priceData.HasOtherRatio("one"))
	assert.False(t, priceData.HasOtherRatio("zero"))

	ratios["positive"] = 99
	ratios["new"] = 3
	nextSnapshot := priceData.OtherRatios()
	assert.Equal(t, 2.5, nextSnapshot["positive"])
	assert.NotContains(t, nextSnapshot, "new")
}

func TestPriceDataReplaceAndApplyOtherRatios(t *testing.T) {
	priceData := types.PriceData{}

	replaced := priceData.ReplaceOtherRatios(map[string]float64{
		"zero":     0,
		"negative": -3,
		"nan":      math.NaN(),
		"inf":      math.Inf(1),
		"one":      1,
		"duration": 2,
		"size":     1.5,
	})

	require.True(t, replaced)
	assert.Equal(t, 3.0, priceData.OtherRatioMultiplier())
	assert.Equal(t, 30.0, priceData.ApplyOtherRatiosToFloat(10))
	assert.Equal(t, 10.0, priceData.RemoveOtherRatiosFromFloat(30))
	assert.True(t, decimal.NewFromInt(30).Equal(priceData.ApplyOtherRatiosToDecimal(decimal.NewFromInt(10))))

	replaced = priceData.ReplaceOtherRatios(map[string]float64{
		"zero": 0,
		"nan":  math.NaN(),
	})

	require.False(t, replaced)
	assert.Nil(t, priceData.OtherRatios())
	assert.Equal(t, 1.0, priceData.OtherRatioMultiplier())
}

func TestTaskBillingOtherFiltersHistoricalOtherRatios(t *testing.T) {
	task := makeTask(1, 1, 100, 0, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.OtherRatios = map[string]float64{
		"seconds":  2,
		"identity": 1,
		"zero":     0,
		"negative": -1,
		"nan":      math.NaN(),
		"inf":      math.Inf(1),
	}

	other := taskBillingOther(task).Snapshot()

	assert.Equal(t, 2.0, other["seconds"])
	assert.Equal(t, 1.0, other["identity"])
	assert.NotContains(t, other, "zero")
	assert.NotContains(t, other, "negative")
	assert.NotContains(t, other, "nan")
	assert.NotContains(t, other, "inf")
	assert.NotContains(t, other, "billing_mode")
	assert.NotContains(t, other, "expr_b64")
	assert.NotContains(t, other, "matched_tier")
	assert.NotContains(t, other, "usage_facts")
}

func TestTaskBillingOtherIncludesTieredSnapshotAndKeepsUsageFactsNested(t *testing.T) {
	task := makeTask(1, 1, 100, 0, BillingSourceWallet, 0)
	expression := `tier("720P", u("seconds") * 5)`
	task.PrivateData.BillingContext.TieredSnapshot = &billingexpr.BillingSnapshot{
		ExprString:    expression,
		EstimatedTier: "720P",
		UsageFacts: map[string]any{
			"resolution": "720P",
			"seconds":    5,
		},
	}

	other := taskBillingOther(task).Snapshot()

	assert.Equal(t, "tiered_expr", other["billing_mode"])
	assert.Equal(t, base64.StdEncoding.EncodeToString([]byte(expression)), other["expr_b64"])
	assert.Equal(t, "720P", other["matched_tier"])
	facts, ok := other["usage_facts"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, map[string]any{
		"resolution": "720P",
		"seconds":    5,
	}, facts)
	assert.NotContains(t, other, "resolution")
	assert.NotContains(t, other, "seconds")
}

func TestTaskBillingOtherOmitsEmptyUsageFacts(t *testing.T) {
	task := makeTask(1, 1, 100, 0, BillingSourceWallet, 0)
	expression := `tier("base", 1)`
	task.PrivateData.BillingContext.TieredSnapshot = &billingexpr.BillingSnapshot{
		ExprString:    expression,
		EstimatedTier: "base",
		UsageFacts:    map[string]any{},
	}

	other := taskBillingOther(task).Snapshot()

	assert.Equal(t, "tiered_expr", other["billing_mode"])
	assert.Equal(t, base64.StdEncoding.EncodeToString([]byte(expression)), other["expr_b64"])
	assert.Equal(t, "base", other["matched_tier"])
	assert.NotContains(t, other, "usage_facts")
}

func callLogTaskConsumption(t *testing.T, info *relaycommon.RelayInfo, task *model.Task) *model.Log {
	t.Helper()
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)
	ctx.Set("token_name", "test_token")
	LogTaskConsumption(ctx, info, task)
	log := getLastLog(t)
	require.NotNil(t, log)
	return log
}

func TestLogTaskConsumptionIncludesTieredSnapshotUsageFacts(t *testing.T) {
	truncate(t)
	const userID, channelID = 40, 40
	seedUser(t, userID, 10_000)
	seedChannel(t, channelID)

	expression := `tier("720P", u("seconds") * 5)`
	task := makeTask(userID, channelID, 100, 0, BillingSourceWallet, 0)
	info := &relaycommon.RelayInfo{
		UserId:          userID,
		TokenId:         0,
		OriginModelName: "wan2.5-i2v-preview",
		UsingGroup:      "default",
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{Action: "GENERATE"},
		PriceData: types.PriceData{
			ModelPrice:     0.02,
			Quota:          100,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
		},
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			ExprString:    expression,
			EstimatedTier: "720P",
			UsageFacts: map[string]any{
				"resolution": "720P",
				"seconds":    5,
			},
		},
	}

	log := callLogTaskConsumption(t, info, task)

	var other map[string]any
	require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
	assert.Equal(t, "tiered_expr", other["billing_mode"])
	assert.Equal(t, base64.StdEncoding.EncodeToString([]byte(expression)), other["expr_b64"])
	assert.Equal(t, "720P", other["matched_tier"])
	facts, ok := other["usage_facts"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "720P", facts["resolution"])
	assert.Equal(t, float64(5), facts["seconds"])
	assert.NotContains(t, other, "resolution")
	assert.NotContains(t, other, "seconds")
	assert.Contains(t, log.Content, "计算参数：")
	assert.Contains(t, log.Content, "resolution: 720P")
	assert.Contains(t, log.Content, "seconds: 5")
}

func TestLogTaskConsumptionWithoutSnapshotKeepsRatioMode(t *testing.T) {
	truncate(t)
	const userID, channelID = 41, 41
	seedUser(t, userID, 10_000)
	seedChannel(t, channelID)

	priceData := types.PriceData{
		ModelPrice:     0.02,
		Quota:          100,
		GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
	}
	priceData.AddOtherRatio("size", 2)
	task := makeTask(userID, channelID, 100, 0, BillingSourceWallet, 0)
	info := &relaycommon.RelayInfo{
		UserId:          userID,
		TokenId:         0,
		OriginModelName: "test-model",
		UsingGroup:      "default",
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
		TaskRelayInfo:   &relaycommon.TaskRelayInfo{Action: "GENERATE"},
		PriceData:       priceData,
	}

	log := callLogTaskConsumption(t, info, task)

	var other map[string]any
	require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
	assert.Equal(t, true, other["is_task"])
	assert.Equal(t, "/v1/videos", other["request_path"])
	assert.NotContains(t, other, "billing_mode")
	assert.NotContains(t, other, "expr_b64")
	assert.NotContains(t, other, "matched_tier")
	assert.NotContains(t, other, "usage_facts")
	assert.Contains(t, log.Content, "计算参数：")
	assert.Contains(t, log.Content, "size: 2.00")
}

func TestTaskBillingOtherSeparatesPluginAndRootDiagnostics(t *testing.T) {
	task := makeTask(1, 1, 100, 0, BillingSourceWallet, 0)
	task.TaskID = "task_public"
	task.PrivateData.UpstreamTaskID = "upstream-private"
	task.PrivateData.NodeName = "node-a"
	task.PrivateData.Execution = &model.TaskExecutionSnapshot{
		TaskPlugin: &model.TaskPluginSnapshot{
			Key:     "document-parser",
			Name:    "Document Parser",
			Version: "1.2.3",
			Author: &model.TaskPluginAuthorSnapshot{
				Name: "Community Author",
				URL:  "https://plugins.example/author",
			},
			APIVersion: 1,
			Generation: 42,
		},
	}

	other := taskBillingOther(task).Snapshot()

	assert.Equal(t, "task_public", other["task_id"])
	adminInfo, ok := other["admin_info"].(map[string]any)
	require.True(t, ok)
	pluginInfo, ok := adminInfo["task_plugin"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "document-parser", pluginInfo["key"])
	assert.Equal(t, "1.2.3", pluginInfo["version"])
	assert.Equal(t, map[string]any{
		"name": "Community Author",
		"url":  "https://plugins.example/author",
	}, pluginInfo["author"])

	rootInfo, ok := other["root_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "upstream-private", rootInfo["upstream_task_id"])
	assert.Equal(t, "node-a", rootInfo["node_name"])
	runtimeInfo, ok := rootInfo["task_plugin"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, uint64(42), runtimeInfo["generation"])
	assert.NotContains(t, runtimeInfo, "author")
}

func TestTaskBillingContextPriceDataFiltersMultiplier(t *testing.T) {
	priceData := taskBillingContextPriceData(&model.TaskBillingContext{
		OtherRatios: map[string]float64{
			"seconds":  2,
			"size":     3,
			"identity": 1,
			"zero":     0,
			"negative": -1,
			"nan":      math.NaN(),
			"inf":      math.Inf(1),
		},
	})

	require.NotNil(t, priceData)
	assert.Equal(t, 6.0, priceData.OtherRatioMultiplier())
	assert.Equal(t, map[string]float64{
		"seconds":  2,
		"size":     3,
		"identity": 1,
	}, priceData.OtherRatios())
}

// ---------------------------------------------------------------------------
// Read-back helpers
// ---------------------------------------------------------------------------

func getUserQuota(t *testing.T, id int) int {
	t.Helper()
	var user model.User
	require.NoError(t, model.DB.Select("quota").Where("id = ?", id).First(&user).Error)
	return user.Quota
}

func getUserUsageAccounting(t *testing.T, id int) (int, int) {
	t.Helper()
	var user model.User
	require.NoError(t, model.DB.Select("used_quota", "request_count").Where("id = ?", id).First(&user).Error)
	return user.UsedQuota, user.RequestCount
}

func getChannelUsedQuota(t *testing.T, id int) int64 {
	t.Helper()
	var channel model.Channel
	require.NoError(t, model.DB.Select("used_quota").Where("id = ?", id).First(&channel).Error)
	return channel.UsedQuota
}

func getTokenRemainQuota(t *testing.T, id int) int {
	t.Helper()
	var token model.Token
	require.NoError(t, model.DB.Select("remain_quota").Where("id = ?", id).First(&token).Error)
	return token.RemainQuota
}

func getTokenUsedQuota(t *testing.T, id int) int {
	t.Helper()
	var token model.Token
	require.NoError(t, model.DB.Select("used_quota").Where("id = ?", id).First(&token).Error)
	return token.UsedQuota
}

func getSubscriptionUsed(t *testing.T, id int) int64 {
	t.Helper()
	var sub model.UserSubscription
	require.NoError(t, model.DB.Select("amount_used").Where("id = ?", id).First(&sub).Error)
	return sub.AmountUsed
}

func getTaskQuota(t *testing.T, id int64) int {
	t.Helper()
	var task model.Task
	require.NoError(t, model.DB.Select("quota").Where("id = ?", id).First(&task).Error)
	return task.Quota
}

func getMidjourneyTask(t *testing.T, id int) model.Midjourney {
	t.Helper()
	var task model.Midjourney
	require.NoError(t, model.DB.First(&task, id).Error)
	return task
}

func getLastLog(t *testing.T) *model.Log {
	t.Helper()
	var log model.Log
	err := model.LOG_DB.Order("id desc").First(&log).Error
	if err != nil {
		return nil
	}
	return &log
}

func countLogs(t *testing.T) int64 {
	t.Helper()
	var count int64
	model.LOG_DB.Model(&model.Log{}).Count(&count)
	return count
}

// ===========================================================================
// Legacy Midjourney billing tests
// ===========================================================================

func TestRefundTaskQuota_Wallet(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 1, 1, 1
	const initQuota, preConsumed = 10000, 3000
	const tokenRemain = 5000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-test-key", tokenRemain)
	seedChannel(t, channelID)
	seedChargedAccounting(t, userID, channelID, tokenID, preConsumed, 1)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelStandardQuota = preConsumed // 官方测试适配：预扣标准口径
	require.NoError(t, model.DB.Create(task).Error)

	assert.True(t, RefundTaskQuota(ctx, task, "task failed: upstream error"))

	// User quota should increase by preConsumed
	assert.Equal(t, initQuota+preConsumed, getUserQuota(t, userID))

	// Token remain_quota should increase, used_quota should decrease
	assert.Equal(t, tokenRemain+preConsumed, getTokenRemainQuota(t, tokenID))
	assert.Zero(t, getTokenUsedQuota(t, tokenID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Zero(t, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Zero(t, getChannelUsedQuota(t, channelID))

	// A refund log should be created
	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
	assert.Equal(t, preConsumed, log.Quota)
	assert.Equal(t, "test-model", log.ModelName)
	assert.Zero(t, task.Quota)
	assert.Zero(t, getTaskQuota(t, task.ID))
}

func TestRefundTaskQuota_Subscription(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID, subID = 2, 2, 2, 1
	const preConsumed = 2000
	const subTotal, subUsed int64 = 100000, 50000
	const tokenRemain = 8000

	seedUser(t, userID, 0)
	seedToken(t, tokenID, userID, "sk-sub-key", tokenRemain)
	seedChannel(t, channelID)
	seedSubscription(t, subID, userID, subTotal, subUsed)
	seedChargedAccounting(t, userID, channelID, tokenID, preConsumed, 1)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceSubscription, subID)
	require.NoError(t, model.DB.Create(task).Error)

	assert.True(t, RefundTaskQuota(ctx, task, "subscription task failed"))

	// Subscription used should decrease by preConsumed
	assert.Equal(t, subUsed-int64(preConsumed), getSubscriptionUsed(t, subID))

	// Token should also be refunded
	assert.Equal(t, tokenRemain+preConsumed, getTokenRemainQuota(t, tokenID))
	assert.Zero(t, getTokenUsedQuota(t, tokenID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Zero(t, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Zero(t, getChannelUsedQuota(t, channelID))

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
	assert.Zero(t, getTaskQuota(t, task.ID))
}

func TestRefundTaskQuota_ZeroQuota(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 3
	seedUser(t, userID, 5000)

	task := makeTask(userID, 0, 0, 0, BillingSourceWallet, 0)

	assert.True(t, RefundTaskQuota(ctx, task, "zero quota task"))

	// No change to user quota
	assert.Equal(t, 5000, getUserQuota(t, userID))

	// No log created
	assert.Equal(t, int64(0), countLogs(t))
}

func TestRefundTaskQuota_NoToken(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, channelID = 4, 4
	const initQuota, preConsumed = 10000, 1500

	seedUser(t, userID, initQuota)
	seedChannel(t, channelID)
	seedChargedAccounting(t, userID, channelID, 0, preConsumed, 1)

	task := makeTask(userID, channelID, preConsumed, 0, BillingSourceWallet, 0) // TokenId=0
	require.NoError(t, model.DB.Create(task).Error)

	assert.True(t, RefundTaskQuota(ctx, task, "no token task failed"))

	// User quota refunded
	assert.Equal(t, initQuota+preConsumed, getUserQuota(t, userID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Zero(t, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Zero(t, getChannelUsedQuota(t, channelID))

	// Log created
	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
	assert.Zero(t, getTaskQuota(t, task.ID))
}

func TestRefundTaskQuota_FundingFailureKeepsAccountingAndPendingMarker(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, channelID, preConsumed = 5, 5, 1200
	seedUser(t, userID, 5000)
	seedChannel(t, channelID)
	seedChargedAccounting(t, userID, channelID, 0, preConsumed, 1)
	task := makeTask(userID, channelID, preConsumed, 0, BillingSourceSubscription, 9999)
	task.Status = model.TaskStatusFailure
	require.NoError(t, model.DB.Create(task).Error)

	assert.False(t, RefundTaskQuota(ctx, task, "subscription missing"))
	assert.Equal(t, 5000, getUserQuota(t, userID))
	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, preConsumed, getTaskQuota(t, task.ID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Equal(t, preConsumed, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Equal(t, int64(preConsumed), getChannelUsedQuota(t, channelID))
	assert.Equal(t, int64(0), countLogs(t))
}

// ===========================================================================
// RecalculateTaskQuota tests
// ===========================================================================

func TestRecalculate_PositiveDelta(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 10, 10, 10
	const initQuota, preConsumed = 10000, 2000
	const actualQuota = 3000 // under-charged by 1000
	const tokenRemain = 5000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-recalc-pos", tokenRemain)
	seedChannel(t, channelID)
	seedChargedAccounting(t, userID, channelID, tokenID, preConsumed, 1)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelStandardQuota = preConsumed // 官方测试适配：预扣标准口径

	RecalculateTaskQuota(ctx, task, actualQuota, actualQuota, "adaptor adjustment")

	// User quota should decrease by the delta (1000 additional charge)
	assert.Equal(t, initQuota-(actualQuota-preConsumed), getUserQuota(t, userID))

	// Token should also be charged the delta
	assert.Equal(t, tokenRemain-(actualQuota-preConsumed), getTokenRemainQuota(t, tokenID))
	assert.Equal(t, actualQuota, getTokenUsedQuota(t, tokenID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Equal(t, actualQuota, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Equal(t, int64(actualQuota), getChannelUsedQuota(t, channelID))

	// task.Quota should be updated to actualQuota
	assert.Equal(t, actualQuota, task.Quota)

	// Log type should be Consume (additional charge)
	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeConsume, log.Type)
	assert.Equal(t, actualQuota-preConsumed, log.Quota)
}

func TestRecalculate_NegativeDelta(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 11, 11, 11
	const initQuota, preConsumed = 10000, 5000
	const actualQuota = 3000 // over-charged by 2000
	const tokenRemain = 5000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-recalc-neg", tokenRemain)
	seedChannel(t, channelID)
	seedChargedAccounting(t, userID, channelID, tokenID, preConsumed, 1)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelStandardQuota = preConsumed // 官方测试适配：预扣标准口径

	RecalculateTaskQuota(ctx, task, actualQuota, actualQuota, "adaptor adjustment")

	// User quota should increase by abs(delta) = 2000 (refund overpayment)
	assert.Equal(t, initQuota+(preConsumed-actualQuota), getUserQuota(t, userID))

	// Token should be refunded the difference
	assert.Equal(t, tokenRemain+(preConsumed-actualQuota), getTokenRemainQuota(t, tokenID))
	assert.Equal(t, actualQuota, getTokenUsedQuota(t, tokenID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Equal(t, actualQuota, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Equal(t, int64(actualQuota), getChannelUsedQuota(t, channelID))

	// task.Quota updated
	assert.Equal(t, actualQuota, task.Quota)

	// Log type should be Refund
	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
	assert.Equal(t, preConsumed-actualQuota, log.Quota)
}

func TestRecalculate_ZeroDelta(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 12
	const initQuota, preConsumed = 10000, 3000

	seedUser(t, userID, initQuota)

	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
	task.PrivateData.ChannelStandardQuota = preConsumed // 官方测试适配：预扣标准口径

	RecalculateTaskQuota(ctx, task, preConsumed, preConsumed, "exact match")

	// No change to user quota
	assert.Equal(t, initQuota, getUserQuota(t, userID))

	// No log created (delta is zero)
	assert.Equal(t, int64(0), countLogs(t))
}

func TestRecalculate_ActualQuotaZero(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, preConsumed = 13, 5000
	const initQuota = 10000

	seedUser(t, userID, initQuota)

	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
	task.PrivateData.ChannelStandardQuota = preConsumed // 官方测试适配：预扣标准口径
	require.NoError(t, model.DB.Create(task).Error)

	RecalculateTaskQuota(ctx, task, 0, 0, "zero actual")

	assert.Equal(t, initQuota+preConsumed, getUserQuota(t, userID))
	assert.Zero(t, task.Quota)
	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
	assert.Equal(t, preConsumed, log.Quota)
}

func TestRecalculate_RejectsNegativeActualQuota(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, preConsumed = 34, 5000
	const initQuota = 10000
	seedUser(t, userID, initQuota)
	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
	task.PrivateData.ChannelStandardQuota = preConsumed // 官方测试适配：预扣标准口径

	RecalculateTaskQuota(ctx, task, -1, -1, "invalid negative actual")

	assert.Equal(t, initQuota, getUserQuota(t, userID))
	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, int64(0), countLogs(t))
}

func TestRecalculate_Subscription_NegativeDelta(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID, subID = 14, 14, 14, 2
	const preConsumed = 5000
	const actualQuota = 2000 // over-charged by 3000
	const subTotal, subUsed int64 = 100000, 50000
	const tokenRemain = 8000

	seedUser(t, userID, 0)
	seedToken(t, tokenID, userID, "sk-sub-recalc", tokenRemain)
	seedChannel(t, channelID)
	seedSubscription(t, subID, userID, subTotal, subUsed)
	seedChargedAccounting(t, userID, channelID, tokenID, preConsumed, 1)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceSubscription, subID)
	task.PrivateData.ChannelStandardQuota = preConsumed // 官方测试适配：预扣标准口径

	RecalculateTaskQuota(ctx, task, actualQuota, actualQuota, "subscription over-charge")

	// Subscription used should decrease by delta (refund 3000)
	assert.Equal(t, subUsed-int64(preConsumed-actualQuota), getSubscriptionUsed(t, subID))

	// Token refunded
	assert.Equal(t, tokenRemain+(preConsumed-actualQuota), getTokenRemainQuota(t, tokenID))
	assert.Equal(t, actualQuota, getTokenUsedQuota(t, tokenID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Equal(t, actualQuota, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Equal(t, int64(actualQuota), getChannelUsedQuota(t, channelID))

	assert.Equal(t, actualQuota, task.Quota)

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
}

// ===========================================================================
// CAS + Billing integration tests
// Simulates the flow in updateVideoSingleTask (service/task_polling.go)
// ===========================================================================

// simulatePollBilling reproduces the CAS + billing logic from updateVideoSingleTask.
// It takes a persisted task (already in DB), applies the new status, and performs
// the conditional update + billing exactly as the polling loop does.
func simulatePollBilling(ctx context.Context, task *model.Task, newStatus model.TaskStatus, actualQuota int) {
	snap := task.Snapshot()

	shouldRefund := false
	shouldSettle := false
	quota := task.Quota

	task.Status = newStatus
	switch string(newStatus) {
	case model.TaskStatusSuccess:
		task.Progress = "100%"
		task.FinishTime = 9999
		shouldSettle = true
	case model.TaskStatusFailure:
		task.Progress = "100%"
		task.FinishTime = 9999
		task.FailReason = "upstream error"
		if quota != 0 {
			shouldRefund = true
		}
	default:
		task.Progress = "50%"
	}

	isDone := task.Status == model.TaskStatus(model.TaskStatusSuccess) || task.Status == model.TaskStatus(model.TaskStatusFailure)
	if isDone && snap.Status != task.Status {
		won, err := task.UpdateWithStatus(snap.Status)
		if err != nil {
			shouldRefund = false
			shouldSettle = false
		} else if !won {
			shouldRefund = false
			shouldSettle = false
		}
	} else if !snap.Equal(task.Snapshot()) {
		_, _ = task.UpdateWithStatus(snap.Status)
	}

	if shouldSettle && actualQuota > 0 {
		RecalculateTaskQuota(ctx, task, actualQuota, actualQuota, "test settle")
	}
	if shouldRefund {
		RefundTaskQuota(ctx, task, task.FailReason)
	}
}

func TestCASGuardedRefund_Win(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 20, 20, 20
	const initQuota, preConsumed = 10000, 4000
	const tokenRemain = 6000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-cas-refund-win", tokenRemain)
	seedChannel(t, channelID)
	seedChargedAccounting(t, userID, channelID, tokenID, preConsumed, 1)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatus(model.TaskStatusInProgress)
	require.NoError(t, model.DB.Create(task).Error)

	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusFailure), 0)

	// CAS wins: task in DB should now be FAILURE
	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusFailure, reloaded.Status)
	assert.Zero(t, reloaded.Quota)

	// Refund should have happened
	assert.Equal(t, initQuota+preConsumed, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain+preConsumed, getTokenRemainQuota(t, tokenID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Zero(t, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Zero(t, getChannelUsedQuota(t, channelID))

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
}

func TestCASGuardedRefund_Lose(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 21, 21, 21
	const initQuota, preConsumed = 10000, 4000
	const tokenRemain = 6000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-cas-refund-lose", tokenRemain)
	seedChannel(t, channelID)
	seedChargedAccounting(t, userID, channelID, tokenID, preConsumed, 1)

	// Create task with IN_PROGRESS in DB
	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatus(model.TaskStatusInProgress)
	require.NoError(t, model.DB.Create(task).Error)

	// Simulate another process already transitioning to FAILURE
	model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Update("status", model.TaskStatusFailure)

	// Our process still has the old in-memory state (IN_PROGRESS) and tries to transition
	// task.Status is still IN_PROGRESS in the snapshot
	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusFailure), 0)

	// CAS lost: user quota should NOT change (no double refund)
	assert.Equal(t, initQuota, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain, getTokenRemainQuota(t, tokenID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Equal(t, preConsumed, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Equal(t, int64(preConsumed), getChannelUsedQuota(t, channelID))

	// No billing log should be created
	assert.Equal(t, int64(0), countLogs(t))
}

func TestCASGuardedSettle_Win(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 22, 22, 22
	const initQuota, preConsumed = 10000, 5000
	const actualQuota = 3000 // over-charged, should get partial refund
	const tokenRemain = 8000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-cas-settle-win", tokenRemain)
	seedChannel(t, channelID)
	seedChargedAccounting(t, userID, channelID, tokenID, preConsumed, 1)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelStandardQuota = preConsumed // 官方测试适配：预扣标准口径
	task.Status = model.TaskStatus(model.TaskStatusInProgress)
	require.NoError(t, model.DB.Create(task).Error)

	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusSuccess), actualQuota)

	// CAS wins: task should be SUCCESS
	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusSuccess, reloaded.Status)

	// Settlement should refund the over-charge (5000 - 3000 = 2000 back to user)
	assert.Equal(t, initQuota+(preConsumed-actualQuota), getUserQuota(t, userID))
	assert.Equal(t, tokenRemain+(preConsumed-actualQuota), getTokenRemainQuota(t, tokenID))
	usedQuota, requestCount := getUserUsageAccounting(t, userID)
	assert.Equal(t, actualQuota, usedQuota)
	assert.Equal(t, 1, requestCount)
	assert.Equal(t, int64(actualQuota), getChannelUsedQuota(t, channelID))

	// task.Quota should be updated to actualQuota
	assert.Equal(t, actualQuota, task.Quota)
}

func TestNonTerminalUpdate_NoBilling(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, channelID = 23, 23
	const initQuota, preConsumed = 10000, 3000

	seedUser(t, userID, initQuota)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, 0, BillingSourceWallet, 0)
	task.Status = model.TaskStatus(model.TaskStatusInProgress)
	task.Progress = "20%"
	require.NoError(t, model.DB.Create(task).Error)

	// Simulate a non-terminal poll update (still IN_PROGRESS, progress changed)
	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusInProgress), 0)

	// User quota should NOT change
	assert.Equal(t, initQuota, getUserQuota(t, userID))

	// No billing log
	assert.Equal(t, int64(0), countLogs(t))

	// Task progress should be updated in DB
	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.Equal(t, "50%", reloaded.Progress)
}

// ===========================================================================
// Mock adaptor for settleTaskBillingOnComplete tests
// ===========================================================================

type mockAdaptor struct {
	adjustReturn int
}

func (m *mockAdaptor) Init(_ *relaycommon.RelayInfo) {}
func (m *mockAdaptor) FetchTask(string, string, *model.Task, string) (*http.Response, error) {
	return nil, nil
}
func (m *mockAdaptor) ParseTaskResult(*model.Task, *http.Response, []byte) (*relaycommon.TaskInfo, error) {
	return nil, nil
}
func (m *mockAdaptor) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return m.adjustReturn
}

// ===========================================================================
// PerCallBilling tests — settleTaskBillingOnComplete
// ===========================================================================

func TestSettle_PerCallBilling_SkipsAdaptorAdjust(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 30, 30, 30
	const initQuota, preConsumed = 10000, 5000
	const tokenRemain = 8000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-percall-adaptor", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.PerCallBilling = true

	adaptor := &mockAdaptor{adjustReturn: 2000}
	taskResult := &relaycommon.TaskInfo{Status: model.TaskStatusSuccess}

	settled := settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)

	// Per-call: no adjustment despite adaptor returning 2000
	assert.False(t, settled)
	assert.Equal(t, initQuota, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, int64(0), countLogs(t))
}

func TestSettle_PerCallBilling_SkipsTotalTokens(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 31, 31, 31
	const initQuota, preConsumed = 10000, 4000
	const tokenRemain = 7000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-percall-tokens", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.PerCallBilling = true

	adaptor := &mockAdaptor{adjustReturn: 0}
	taskResult := &relaycommon.TaskInfo{Status: model.TaskStatusSuccess, TotalTokens: 9999}

	settled := settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)

	// Per-call: no recalculation by tokens
	assert.False(t, settled)
	assert.Equal(t, initQuota, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, int64(0), countLogs(t))
}

func TestSettle_NonPerCallBilling_AppliesAdaptorAdjustment(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 32, 32, 32
	const initQuota, preConsumed = 10000, 5000
	const adaptorQuota = 3000
	const tokenRemain = 8000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-nonpercall-adj", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	// PerCallBilling defaults to false

	adaptor := &mockAdaptor{adjustReturn: adaptorQuota}
	taskResult := &relaycommon.TaskInfo{Status: model.TaskStatusSuccess}

	settled := settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)

	// Non-per-call: adaptor adjustment applies (refund 2000)
	assert.True(t, settled)
	assert.Equal(t, initQuota+(preConsumed-adaptorQuota), getUserQuota(t, userID))
	assert.Equal(t, tokenRemain+(preConsumed-adaptorQuota), getTokenRemainQuota(t, tokenID))
	assert.Equal(t, adaptorQuota, task.Quota)

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
}

func TestSettle_TieredEvaluationFailureKeepsPreConsumedCharge(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, preConsumed = 33, 5_000
	const initialQuota = 10_000
	seedUser(t, userID, initialQuota)

	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.TieredSnapshot = &billingexpr.BillingSnapshot{
		ExprString:       `tier("broken",`,
		ExprHash:         billingexpr.ExprHashString(`tier("broken",`),
		GroupRatio:       1,
		QuotaPerUnit:     1_000,
		ExprVersion:      1,
		TaskUsageBilling: true,
	}

	settled := settleTaskBillingOnComplete(ctx, &mockAdaptor{}, task, &relaycommon.TaskInfo{Status: model.TaskStatusFailure})

	assert.True(t, settled)
	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, initialQuota, getUserQuota(t, userID))
	assert.Equal(t, int64(0), countLogs(t))
}

func TestSettle_TieredFailureReturnsFalseForCallerRefund(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 37
	const initialQuota, preConsumed = 10_000, 25
	seedUser(t, userID, initialQuota)

	expression := `tier("base", u("seconds") + u("clips") * 10)`
	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
	task.Status = model.TaskStatusFailure
	task.PrivateData.BillingContext.TieredSnapshot = &billingexpr.BillingSnapshot{
		ExprString:       expression,
		ExprHash:         billingexpr.ExprHashString(expression),
		GroupRatio:       1,
		QuotaPerUnit:     1,
		ExprVersion:      1,
		TaskUsageBilling: true,
		UsageFacts:       map[string]any{"seconds": float64(5), "clips": float64(2)},
		EstimatedTier:    "base",
	}

	settled := settleTaskBillingOnComplete(
		ctx,
		&mockAdaptor{adjustReturn: 1},
		task,
		&relaycommon.TaskInfo{Status: model.TaskStatusFailure, UsageFacts: map[string]any{"seconds": float64(8)}},
	)

	assert.False(t, settled)
	assert.Equal(t, preConsumed, task.Quota)
	assert.Equal(t, map[string]any{"seconds": float64(5), "clips": float64(2)}, task.PrivateData.BillingContext.TieredSnapshot.UsageFacts)
	assert.Equal(t, "base", task.PrivateData.BillingContext.TieredSnapshot.EstimatedTier)
	assert.Equal(t, initialQuota, getUserQuota(t, userID))
	assert.Equal(t, int64(0), countLogs(t))
}

func TestSettle_TieredSuccessStillRecomputes(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID = 38
	const initialQuota, preConsumed = 10_000, 50
	seedUser(t, userID, initialQuota)

	expression := `tier("base", u("seconds") + u("clips") * 10)`
	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
	task.Status = model.TaskStatusSuccess
	task.PrivateData.BillingContext.TieredSnapshot = &billingexpr.BillingSnapshot{
		ExprString:       expression,
		ExprHash:         billingexpr.ExprHashString(expression),
		GroupRatio:       1,
		QuotaPerUnit:     1,
		ExprVersion:      1,
		TaskUsageBilling: true,
		UsageFacts:       map[string]any{"seconds": float64(5), "clips": float64(2)},
		EstimatedTier:    "base",
	}

	settled := settleTaskBillingOnComplete(
		ctx,
		&mockAdaptor{adjustReturn: 1},
		task,
		&relaycommon.TaskInfo{Status: model.TaskStatusSuccess, UsageFacts: map[string]any{"seconds": float64(8)}},
	)

	assert.True(t, settled)
	assert.Equal(t, 28, task.Quota)
	assert.Equal(t, map[string]any{"seconds": float64(8), "clips": float64(2)}, task.PrivateData.BillingContext.TieredSnapshot.UsageFacts)
	assert.Equal(t, "base", task.PrivateData.BillingContext.TieredSnapshot.EstimatedTier)
	assert.Equal(t, initialQuota+(preConsumed-28), getUserQuota(t, userID))

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
	var other map[string]any
	require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
	assert.Equal(t, "tiered_expr", other["billing_mode"])
	assert.Equal(t, "base", other["matched_tier"])
	facts, ok := other["usage_facts"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, map[string]any{"seconds": float64(8), "clips": float64(2)}, facts)
}

func TestSettle_TieredUsageFactsMergeCompletionOverSubmission(t *testing.T) {
	tests := []struct {
		name            string
		completionFacts map[string]any
		expectedQuota   int
		expectedFacts   map[string]any
	}{
		{
			name:          "submission facts survive missing completion facts",
			expectedQuota: 25,
			expectedFacts: map[string]any{"seconds": float64(5), "clips": float64(2)},
		},
		{
			name:            "completion facts partially override submission facts",
			completionFacts: map[string]any{"seconds": float64(8)},
			expectedQuota:   28,
			expectedFacts:   map[string]any{"seconds": float64(8), "clips": float64(2)},
		},
		{
			name:            "completion facts fully override submission facts",
			completionFacts: map[string]any{"seconds": float64(8), "clips": float64(3)},
			expectedQuota:   38,
			expectedFacts:   map[string]any{"seconds": float64(8), "clips": float64(3)},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			truncate(t)
			const userID = 34
			const initialQuota = 10_000
			const preConsumed = 50
			seedUser(t, userID, initialQuota)

			expression := `tier("base", u("seconds") + u("clips") * 10)`
			submissionFacts := map[string]any{"seconds": float64(5), "clips": float64(2)}
			task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
			task.PrivateData.BillingContext.TieredSnapshot = &billingexpr.BillingSnapshot{
				ExprString:       expression,
				ExprHash:         billingexpr.ExprHashString(expression),
				GroupRatio:       1,
				QuotaPerUnit:     1,
				ExprVersion:      1,
				TaskUsageBilling: true,
				UsageFacts:       submissionFacts,
				EstimatedTier:    "base",
			}

			settled := settleTaskBillingOnComplete(
				context.Background(),
				&mockAdaptor{},
				task,
				&relaycommon.TaskInfo{Status: model.TaskStatusSuccess, UsageFacts: testCase.completionFacts},
			)

			assert.True(t, settled)
			assert.Equal(t, testCase.expectedQuota, task.Quota)
			assert.Equal(t, map[string]any{"seconds": float64(5), "clips": float64(2)}, submissionFacts)
			require.NotNil(t, task.PrivateData.BillingContext.TieredSnapshot)
			assert.Equal(t, testCase.expectedFacts, task.PrivateData.BillingContext.TieredSnapshot.UsageFacts)
			assert.Equal(t, "base", task.PrivateData.BillingContext.TieredSnapshot.EstimatedTier)

			log := getLastLog(t)
			require.NotNil(t, log)
			var other map[string]any
			require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
			assert.Equal(t, "tiered_expr", other["billing_mode"])
			assert.Equal(t, "base", other["matched_tier"])
			facts, ok := other["usage_facts"].(map[string]any)
			require.True(t, ok)
			assert.Equal(t, testCase.expectedFacts, facts)
			assert.NotContains(t, other, "seconds")
			assert.NotContains(t, other, "clips")
		})
	}
}

func TestSettle_TieredSnapshotWriteBackUsesSettledFactsAndMatchedTier(t *testing.T) {
	truncate(t)
	const userID = 36
	const initialQuota = 10_000
	const preConsumed = 25
	seedUser(t, userID, initialQuota)

	expression := `u("resolution") == "1080P" ? tier("1080P", u("seconds") * 10) : tier("720P", u("seconds") * 5)`
	task := makeTask(userID, 0, preConsumed, 0, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.TieredSnapshot = &billingexpr.BillingSnapshot{
		ExprString:       expression,
		ExprHash:         billingexpr.ExprHashString(expression),
		GroupRatio:       1,
		QuotaPerUnit:     1,
		ExprVersion:      1,
		TaskUsageBilling: true,
		UsageFacts:       map[string]any{"resolution": "720P", "seconds": float64(5)},
		EstimatedTier:    "720P",
	}

	settled := settleTaskBillingOnComplete(
		context.Background(),
		&mockAdaptor{},
		task,
		&relaycommon.TaskInfo{
			Status:     model.TaskStatusSuccess,
			UsageFacts: map[string]any{"resolution": "1080P"},
		},
	)

	require.True(t, settled)
	snap := task.PrivateData.BillingContext.TieredSnapshot
	require.NotNil(t, snap)
	assert.Equal(t, map[string]any{"resolution": "1080P", "seconds": float64(5)}, snap.UsageFacts)
	assert.Equal(t, "1080P", snap.EstimatedTier)
	assert.Equal(t, 50, task.Quota)

	log := getLastLog(t)
	require.NotNil(t, log)
	var other map[string]any
	require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
	assert.Equal(t, "tiered_expr", other["billing_mode"])
	assert.Equal(t, "1080P", other["matched_tier"])
	facts, ok := other["usage_facts"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "1080P", facts["resolution"])
	assert.Equal(t, float64(5), facts["seconds"])
	assert.NotContains(t, other, "resolution")
	assert.NotContains(t, other, "seconds")
}

func TestSettle_TokenRecalcFallsBackToCompletionTokens(t *testing.T) {
	previousRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"test-model":1}`))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios))
	})

	tests := []struct {
		name             string
		totalTokens      int
		completionTokens int
		wantSettled      bool
		wantQuota        int
	}{
		{
			name:             "total tokens still win when both are present",
			totalTokens:      80,
			completionTokens: 20,
			wantSettled:      true,
			wantQuota:        80,
		},
		{
			name:             "completion tokens trigger recalc when total is zero",
			totalTokens:      0,
			completionTokens: 80,
			wantSettled:      true,
			wantQuota:        80,
		},
		{
			name:        "neither token count skips recalc",
			wantSettled: false,
			wantQuota:   50,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			truncate(t)
			const userID, tokenID, channelID = 35, 35, 35
			const initialQuota, preConsumed, tokenRemain = 10_000, 50, 8_000
			seedUser(t, userID, initialQuota)
			seedToken(t, tokenID, userID, "sk-completion-fallback", tokenRemain)
			seedChannel(t, channelID)

			task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
			settled := settleTaskBillingOnComplete(
				context.Background(),
				&mockAdaptor{},
				task,
				&relaycommon.TaskInfo{
					Status:           model.TaskStatusSuccess,
					TotalTokens:      testCase.totalTokens,
					CompletionTokens: testCase.completionTokens,
				},
			)

			assert.Equal(t, testCase.wantSettled, settled)
			assert.Equal(t, testCase.wantQuota, task.Quota)
		})
	}
}

// ─────────────── Skye 渠道账本回归测试（自 fork task_billing_test.go 移植，适配 rc.37 签名）───────────────

func applyTaskPreconsume(t *testing.T, when time.Time, task *model.Task, selectedKey string, keyIndex int) string {
	t.Helper()
	task.PrivateData.ChannelUsageRecordedAt = when.Unix()
	params := ChannelUsageRecordParams{
		ChannelID:      task.ChannelId,
		Quota:          task.Quota,
		RequestCount:   1,
		Now:            when,
		ModelName:      task.Properties.OriginModelName,
		Group:          task.Group,
		HasKeyIdentity: strings.TrimSpace(selectedKey) != "",
		SelectedKey:    selectedKey,
		KeyIndex:       keyIndex,
	}
	require.NoError(t, RecordChannelUsage(params))

	fingerprint := ""
	if strings.TrimSpace(selectedKey) != "" {
		var err error
		fingerprint, err = model.FingerprintChannelKey(selectedKey)
		require.NoError(t, err)
	}
	return fingerprint
}

func getChannelKeyUsageByFingerprint(t *testing.T, channelID int, fingerprint string) model.ChannelKeyUsage {
	t.Helper()
	var usage model.ChannelKeyUsage
	require.NoError(t, model.DB.Where("channel_id = ? AND key_fingerprint = ?", channelID, fingerprint).First(&usage).Error)
	return usage
}

func getChannelKeyUsageByIndex(t *testing.T, channelID int, keyIndex int) model.ChannelKeyUsage {
	t.Helper()
	var usage model.ChannelKeyUsage
	require.NoError(t, model.DB.Where("channel_id = ? AND key_index = ?", channelID, keyIndex).First(&usage).Error)
	return usage
}

func getChannelQuotaState(t *testing.T, channelID int) model.Channel {
	t.Helper()
	var channel model.Channel
	require.NoError(t, model.DB.First(&channel, channelID).Error)
	return channel
}

func requireNoChannelUsageDailyRow(t *testing.T, channelID int, keyFingerprint string, usageDate string) {
	t.Helper()
	var row model.ChannelUsageDaily
	err := model.DB.Where("channel_id = ? AND key_fingerprint = ? AND usage_date = ?", channelID, keyFingerprint, usageDate).First(&row).Error
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func seedTaskBillingUsageChannel(t *testing.T, channel *model.Channel) []*model.ChannelKeyUsage {
	t.Helper()
	seedChannelUsageTestChannel(t, channel)
	usages, err := model.EnsureChannelKeyUsageRecords(channel)
	require.NoError(t, err)
	ordered := make([]*model.ChannelKeyUsage, 0, len(channel.GetKeys()))
	for idx := range channel.GetKeys() {
		if usage, ok := usages[idx]; ok && usage != nil {
			ordered = append(ordered, usage)
		}
	}
	return ordered
}

func TestCASGuardedFailureBillingDoesNotDoubleRollbackChannelUsage(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 22, 22, 122
	const preConsumed = 50
	when := time.Date(2026, 8, 2, 15, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-cas-channel", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-cas-channel",
		Key:            "sk-cas-channel",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeBoth,
		QuotaLimit:     200,
		Group:          "default",
		Models:         "test-model",
	}
	seedTaskBillingUsageChannel(t, channel)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatus(model.TaskStatusInProgress)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, "sk-cas-channel", 0)
	task.PrivateData.ChannelKeyIndex = 0
	require.NoError(t, model.DB.Create(task).Error)

	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusFailure), 0)
	simulatePollBilling(ctx, task, model.TaskStatus(model.TaskStatusFailure), 0)

	reloaded := getChannelQuotaState(t, channelID)
	assert.EqualValues(t, 0, reloaded.UsedQuota)
	assert.EqualValues(t, 0, reloaded.QuotaLimitUsed)
	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.EqualValues(t, 0, keyUsage.QuotaLimitUsed)
}

func TestLogTaskConsumptionRecordsSelectedChannelKey(t *testing.T) {
	truncate(t)

	const userID, channelID = 19, 19
	seedUser(t, userID, 10000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-submit-key",
		Key:            "sk-task-submit",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeBoth,
		QuotaLimit:     1000,
		Group:          "default",
		Models:         "test-model",
	}
	seedChannelUsageTestChannel(t, channel)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/tasks", nil)
	ctx.Set("username", "test_user")
	ctx.Set("token_name", "test_token")
	ctx.Set(common.RequestIdKey, "req-task-submit")

	info := &relaycommon.RelayInfo{
		UserId:          userID,
		OriginModelName: "test-model",
		UsingGroup:      "default",
		RequestId:       "req-task-submit",
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			Action: "test",
		},
		PriceData: types.PriceData{
			Quota:      25,
			ModelPrice: 0.01,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio: 1,
			},
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelId:            channelID,
			ApiKey:               "sk-task-submit",
			ChannelMultiKeyIndex: 0,
		},
	}

	LogTaskConsumption(ctx, info, &model.Task{Platform: "55", ChannelId: channelID})

	var keyUsage model.ChannelKeyUsage
	require.NoError(t, model.DB.Where("channel_id = ?", channelID).First(&keyUsage).Error)
	assert.EqualValues(t, 25, keyUsage.QuotaLimitUsed)

	var detail model.ChannelUsageDaily
	require.NoError(t, model.DB.Where("channel_id = ? AND key_fingerprint = ?", channelID, keyUsage.KeyFingerprint).First(&detail).Error)
	assert.EqualValues(t, 25, detail.Quota)
	assert.EqualValues(t, 1, detail.RequestCount)
}

func TestRecalculateTaskQuota_NegativeDeltaAdjustsFinalChannelQuota(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 15, 15, 115
	const preConsumed = 70
	const actualQuota = 25
	when := time.Date(2026, 8, 2, 11, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-recalc-final-less", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-final-less",
		Key:            "sk-recalc-final-less",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeBoth,
		QuotaLimit:     100,
		Group:          "default",
		Models:         "test-model",
	}
	seedTaskBillingUsageChannel(t, channel)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, "sk-recalc-final-less", 0)
	task.PrivateData.ChannelKeyIndex = 0

	RecalculateTaskQuota(ctx, task, actualQuota, 0, "less than preconsume")

	reloaded := getChannelQuotaState(t, channelID)
	assert.EqualValues(t, actualQuota, reloaded.UsedQuota)
	assert.EqualValues(t, actualQuota, reloaded.QuotaLimitUsed)

	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.EqualValues(t, actualQuota, keyUsage.QuotaLimitUsed)

	usageDate := channelUsageDateForServiceTest(when)
	summary := getChannelUsageDailyRow(t, channelID, "", usageDate)
	assert.EqualValues(t, actualQuota, summary.Quota)
	assert.EqualValues(t, 1, summary.RequestCount)
	detail := getChannelUsageDailyRow(t, channelID, task.PrivateData.ChannelKeyFingerprint, usageDate)
	assert.EqualValues(t, actualQuota, detail.Quota)
	assert.EqualValues(t, 1, detail.RequestCount)
}

func TestRecalculateTaskQuota_NegativeDeltaReenablesKeyOnlyChannelAfterPositiveDeltaExhaustion(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 26, 26, 126
	const preConsumed = 5
	const exhaustedQuota = 12
	when := time.Date(2026, 8, 2, 17, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-delta-reenable", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-delta-reenable",
		Key:            "sk-delta-reenable",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeKey,
		Group:          "default",
		Models:         "test-model",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 1,
		},
	}
	usages := seedTaskBillingUsageChannel(t, channel)
	require.Len(t, usages, 1)
	require.NoError(t, model.UpdateChannelKeyQuotaLimit(channelID, usages[0].KeyFingerprint, 10))

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, channel.Key, 0)
	task.PrivateData.ChannelKeyIndex = 0

	RecalculateTaskQuota(ctx, task, exhaustedQuota, 0, "exhaust key after settlement")
	assert.Equal(t, common.ChannelStatusAutoDisabled, getChannelQuotaState(t, channelID).Status)

	RecalculateTaskQuota(ctx, task, preConsumed, 0, "refund settlement delta")

	reloaded := getChannelQuotaState(t, channelID)
	assert.Equal(t, common.ChannelStatusEnabled, reloaded.Status)
	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.Equal(t, common.ChannelStatusEnabled, keyUsage.Status)
	assert.EqualValues(t, preConsumed, keyUsage.QuotaLimitUsed)
}

func TestRecalculateTaskQuota_PositiveDeltaAdjustsFinalChannelQuota(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 16, 16, 116
	const preConsumed = 30
	const actualQuota = 80
	when := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-recalc-final-more", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-final-more",
		Key:            "sk-recalc-final-more",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeBoth,
		QuotaLimit:     200,
		Group:          "default",
		Models:         "test-model",
	}
	seedTaskBillingUsageChannel(t, channel)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, "sk-recalc-final-more", 0)
	task.PrivateData.ChannelKeyIndex = 0

	RecalculateTaskQuota(ctx, task, actualQuota, 0, "more than preconsume")

	reloaded := getChannelQuotaState(t, channelID)
	assert.EqualValues(t, actualQuota, reloaded.UsedQuota)
	assert.EqualValues(t, actualQuota, reloaded.QuotaLimitUsed)

	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.EqualValues(t, actualQuota, keyUsage.QuotaLimitUsed)

	usageDate := channelUsageDateForServiceTest(when)
	summary := getChannelUsageDailyRow(t, channelID, "", usageDate)
	assert.EqualValues(t, actualQuota, summary.Quota)
	assert.EqualValues(t, 1, summary.RequestCount)
	detail := getChannelUsageDailyRow(t, channelID, task.PrivateData.ChannelKeyFingerprint, usageDate)
	assert.EqualValues(t, actualQuota, detail.Quota)
	assert.EqualValues(t, 1, detail.RequestCount)
}

func TestRecalculateTaskQuota_PositiveDeltaDisablesLastExhaustedKey(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 19, 19, 119
	const preConsumed = 5
	const actualQuota = 12
	when := time.Date(2026, 7, 22, 9, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-final-exhaust", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-final-exhaust",
		Key:            "sk-final-exhaust",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeKey,
		Group:          "default",
		Models:         "test-model",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 1,
		},
	}
	usages := seedTaskBillingUsageChannel(t, channel)
	require.Len(t, usages, 1)
	require.NoError(t, model.UpdateChannelKeyQuotaLimit(channelID, usages[0].KeyFingerprint, 10))

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, "sk-final-exhaust", 0)
	task.PrivateData.ChannelKeyIndex = 0

	RecalculateTaskQuota(ctx, task, actualQuota, 0, "final quota exhausted key")

	reloaded := getChannelQuotaState(t, channelID)
	assert.Equal(t, common.ChannelStatusAutoDisabled, reloaded.Status)
	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.EqualValues(t, actualQuota, keyUsage.QuotaLimitUsed)
	assert.Equal(t, common.ChannelStatusAutoDisabled, keyUsage.Status)
}

func TestRefundTaskQuota_ReenablesAutoDisabledChannelAndKeyAfterPreconsumeRollback(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 20, 20, 120
	const preConsumed = 20
	when := time.Date(2026, 8, 2, 14, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-task-reenable", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-reenable",
		Key:            "sk-task-reenable",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeBoth,
		QuotaLimit:     20,
		Group:          "default",
		Models:         "test-model",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 1,
		},
	}
	usages := seedTaskBillingUsageChannel(t, channel)
	require.Len(t, usages, 1)
	require.NoError(t, model.UpdateChannelKeyQuotaLimit(channelID, usages[0].KeyFingerprint, preConsumed))

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, "sk-task-reenable", 0)
	task.PrivateData.ChannelKeyIndex = 0

	beforeRefund := getChannelQuotaState(t, channelID)
	assert.Equal(t, common.ChannelStatusAutoDisabled, beforeRefund.Status)

	RefundTaskQuota(ctx, task, "upstream failed")

	reloaded := getChannelQuotaState(t, channelID)
	assert.Equal(t, common.ChannelStatusEnabled, reloaded.Status)
	assert.EqualValues(t, 0, reloaded.QuotaLimitUsed)
	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.Equal(t, common.ChannelStatusEnabled, keyUsage.Status)
	assert.EqualValues(t, 0, keyUsage.QuotaLimitUsed)
}

func TestRefundTaskQuota_ReenablesKeyOnlyChannelAfterPreconsumeRollback(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 24, 24, 124
	const preConsumed = 20
	when := time.Date(2026, 8, 2, 15, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-task-key-only-reenable", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-key-only-reenable",
		Key:            "sk-task-key-only-reenable",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeKey,
		Group:          "default",
		Models:         "test-model",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 1,
		},
	}
	usages := seedTaskBillingUsageChannel(t, channel)
	require.Len(t, usages, 1)
	require.NoError(t, model.UpdateChannelKeyQuotaLimit(channelID, usages[0].KeyFingerprint, preConsumed))

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, channel.Key, 0)
	task.PrivateData.ChannelKeyIndex = 0

	beforeRefund := getChannelQuotaState(t, channelID)
	assert.Equal(t, common.ChannelStatusAutoDisabled, beforeRefund.Status)

	RefundTaskQuota(ctx, task, "upstream failed")

	reloaded := getChannelQuotaState(t, channelID)
	assert.Equal(t, common.ChannelStatusEnabled, reloaded.Status)
	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.Equal(t, common.ChannelStatusEnabled, keyUsage.Status)
	assert.EqualValues(t, 0, keyUsage.QuotaLimitUsed)
}

// ===========================================================================
// CAS + Billing integration tests
// Simulates the flow in updateVideoSingleTask (service/task_polling.go)
// ===========================================================================

// simulatePollBilling reproduces the CAS + billing logic from updateVideoSingleTask.
// It takes a persisted task (already in DB), applies the new status, and performs
// the conditional update + billing exactly as the polling loop does.

func TestRefundTaskQuota_RollsBackChannelQuotaToZero(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 5, 5, 105
	const preConsumed = 60
	when := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-refund-channel", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-refund-channel",
		Key:            "sk-refund-channel",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeBoth,
		QuotaLimit:     100,
		Group:          "default",
		Models:         "test-model",
	}
	seedTaskBillingUsageChannel(t, channel)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, "sk-refund-channel", 0)
	task.PrivateData.ChannelKeyIndex = 0

	RefundTaskQuota(ctx, task, "task failed")

	reloaded := getChannelQuotaState(t, channelID)
	assert.EqualValues(t, 0, reloaded.UsedQuota)
	assert.EqualValues(t, 0, reloaded.QuotaLimitUsed)
	assert.Equal(t, common.ChannelStatusEnabled, reloaded.Status)

	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.EqualValues(t, 0, keyUsage.QuotaLimitUsed)
	assert.Equal(t, common.ChannelStatusEnabled, keyUsage.Status)

	usageDate := channelUsageDateForServiceTest(when)
	summary := getChannelUsageDailyRow(t, channelID, "", usageDate)
	assert.EqualValues(t, 0, summary.Quota)
	assert.EqualValues(t, 1, summary.RequestCount)
	detail := getChannelUsageDailyRow(t, channelID, task.PrivateData.ChannelKeyFingerprint, usageDate)
	assert.EqualValues(t, 0, detail.Quota)
	assert.EqualValues(t, 1, detail.RequestCount)
}

// ===========================================================================
// RecalculateTaskQuota tests
// ===========================================================================

func TestRefundTaskQuota_RollsBackUsageAfterQuotaModeIsDisabled(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 18, 18, 118
	const preConsumed = 35
	when := time.Date(2026, 7, 21, 9, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-mode-change", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-mode-change",
		Key:            "sk-mode-change",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeBoth,
		QuotaLimit:     100,
		Group:          "default",
		Models:         "test-model",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 1,
		},
	}
	usages := seedTaskBillingUsageChannel(t, channel)
	require.Len(t, usages, 1)
	require.NoError(t, model.UpdateChannelKeyQuotaLimit(channelID, usages[0].KeyFingerprint, 100))

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, "sk-mode-change", 0)
	task.PrivateData.ChannelKeyIndex = 0

	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Update("quota_limit_mode", model.ChannelQuotaLimitModeNone).Error)

	RefundTaskQuota(ctx, task, "task failed after quota mode change")

	reloaded := getChannelQuotaState(t, channelID)
	assert.EqualValues(t, 0, reloaded.UsedQuota)
	assert.EqualValues(t, 0, reloaded.QuotaLimitUsed)
	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.EqualValues(t, 0, keyUsage.QuotaLimitUsed)
}

func TestSettle_NonPerCall_AdaptorAdjustWorks(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 32, 32, 32
	const initQuota, preConsumed = 10000, 5000
	const adaptorQuota = 3000
	const tokenRemain = 8000

	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-nonpercall-adj", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	// PerCallBilling defaults to false

	adaptor := &mockAdaptor{adjustReturn: adaptorQuota}
	taskResult := &relaycommon.TaskInfo{Status: model.TaskStatusSuccess}

	settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)

	// Non-per-call: adaptor adjustment applies (refund 2000)
	assert.Equal(t, initQuota+(preConsumed-adaptorQuota), getUserQuota(t, userID))
	assert.Equal(t, tokenRemain+(preConsumed-adaptorQuota), getTokenRemainQuota(t, tokenID))
	assert.Equal(t, adaptorQuota, task.Quota)

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
}

func TestSettle_PerCallBilling_RecordsTokensWithoutConsumingTokenCountAsQuota(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 25, 25, 125
	const preConsumed = 40
	const totalTokens = 100000
	when := time.Date(2026, 8, 2, 16, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-task-token-stats", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-token-stats",
		Key:            "sk-task-token-stats",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeKey,
		Group:          "default",
		Models:         "test-model",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 1,
		},
	}
	usages := seedTaskBillingUsageChannel(t, channel)
	require.Len(t, usages, 1)
	require.NoError(t, model.UpdateChannelKeyQuotaLimit(channelID, usages[0].KeyFingerprint, 100))

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.PerCallBilling = true
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, channel.Key, 0)
	task.PrivateData.ChannelKeyIndex = 0

	settleTaskBillingOnComplete(
		ctx,
		&mockAdaptor{},
		task,
		&relaycommon.TaskInfo{Status: model.TaskStatusSuccess, TotalTokens: totalTokens},
	)

	reloaded := getChannelQuotaState(t, channelID)
	assert.EqualValues(t, preConsumed, reloaded.UsedQuota)
	assert.Zero(t, reloaded.QuotaLimitUsed)
	keyUsage := getChannelKeyUsageByFingerprint(t, channelID, task.PrivateData.ChannelKeyFingerprint)
	assert.EqualValues(t, preConsumed, keyUsage.QuotaLimitUsed)

	usageDate := channelUsageDateForServiceTest(when)
	summary := getChannelUsageDailyRow(t, channelID, "", usageDate)
	assert.EqualValues(t, preConsumed, summary.Quota)
	assert.EqualValues(t, totalTokens, summary.TokenUsed)
	detail := getChannelUsageDailyRow(t, channelID, task.PrivateData.ChannelKeyFingerprint, usageDate)
	assert.EqualValues(t, preConsumed, detail.Quota)
	assert.EqualValues(t, totalTokens, detail.TokenUsed)
}

func TestTaskBillingUsesPersistedFingerprintForMultiKeySettlement(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 17, 17, 117
	const preConsumed = 40
	const actualQuota = 10
	when := time.Date(2026, 8, 2, 13, 0, 0, 0, time.UTC)

	seedUser(t, userID, 10000)
	seedToken(t, tokenID, userID, "sk-task-multi-key", 1000)
	channel := &model.Channel{
		Id:             channelID,
		Name:           "task-multi-key",
		Key:            "sk-alpha\nsk-beta",
		Status:         common.ChannelStatusEnabled,
		QuotaLimitMode: model.ChannelQuotaLimitModeKey,
		Group:          "default",
		Models:         "test-model",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 2,
		},
	}
	usages := seedTaskBillingUsageChannel(t, channel)
	require.Len(t, usages, 2)
	require.NoError(t, model.UpdateChannelKeyQuotaLimit(channelID, usages[1].KeyFingerprint, 100))

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.PrivateData.ChannelKeyFingerprint = applyTaskPreconsume(t, when, task, "sk-beta", 1)
	task.PrivateData.ChannelKeyIndex = 1

	RecalculateTaskQuota(ctx, task, actualQuota, 0, "settle on beta")

	alphaUsage := getChannelKeyUsageByIndex(t, channelID, 0)
	betaUsage := getChannelKeyUsageByIndex(t, channelID, 1)
	assert.EqualValues(t, 0, alphaUsage.QuotaLimitUsed)
	assert.EqualValues(t, actualQuota, betaUsage.QuotaLimitUsed)
	assert.Equal(t, task.PrivateData.ChannelKeyFingerprint, betaUsage.KeyFingerprint)

	usageDate := channelUsageDateForServiceTest(when)
	summary := getChannelUsageDailyRow(t, channelID, "", usageDate)
	assert.EqualValues(t, actualQuota, summary.Quota)
	requireNoChannelUsageDailyRow(t, channelID, alphaUsage.KeyFingerprint, usageDate)
	detail := getChannelUsageDailyRow(t, channelID, betaUsage.KeyFingerprint, usageDate)
	assert.EqualValues(t, actualQuota, detail.Quota)
}

func truncate(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM tasks")
		model.DB.Exec("DELETE FROM users")
		model.DB.Exec("DELETE FROM tokens")
		model.DB.Exec("DELETE FROM logs")
		model.DB.Exec("DELETE FROM channels")
		model.DB.Exec("DELETE FROM midjourneys")
		model.DB.Exec("DELETE FROM top_ups")
		model.DB.Exec("DELETE FROM user_subscriptions")
		model.DB.Exec("DELETE FROM wallet_operations")
		model.DB.Exec("DELETE FROM wallet_transactions")
		model.DB.Exec("DELETE FROM wallet_cash_lots")
		model.DB.Exec("DELETE FROM wallet_consumption_allocations")
		model.DB.Exec("DELETE FROM system_task_locks")
		model.DB.Exec("DELETE FROM system_tasks")
		model.DB.Exec("DELETE FROM task_artifact_objects")
	})
}

func seedUser(t *testing.T, id int, quota int) {
	t.Helper()
	user := &model.User{Id: id, Username: "test_user", Quota: quota, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(user).Error)
}

func TestTaskUsageBillingQuoteAndCompletionKeepPluginAddonSeparate(t *testing.T) {
	baseExpr := `u("resolution") == "2K" ? tier("2K", u("seconds") * 3) : tier("768", u("seconds"))`
	addonExpr := `u("resolution") == "2K" ? tier("2K reference media", u("input_images") * 11 + u("input_video_seconds") * 7) : tier("768 reference media", u("input_images") * 5 + u("input_video_seconds") * 3)`
	submissionFacts := map[string]any{
		"seconds":             float64(5),
		"resolution":          "2K",
		"input_images":        float64(2),
		"input_video_seconds": float64(15),
	}

	hailuo, err := QuoteTaskUsageBilling("MiniMax-H3", "hailuo", baseExpr, addonExpr, submissionFacts, 1)
	require.NoError(t, err)
	require.NotNil(t, hailuo.Snapshot)
	require.Len(t, hailuo.Snapshot.Components, 2)
	assert.Equal(t, "base", hailuo.Snapshot.Components[0].Kind)
	assert.Equal(t, "plugin_addon", hailuo.Snapshot.Components[1].Kind)
	assert.Equal(t, "hailuo", hailuo.Snapshot.Components[1].PluginKey)
	assert.Equal(t, 142*common.QuotaPerUnit, hailuo.Snapshot.EstimatedQuotaBeforeGroup)
	assert.Equal(t, int(142*common.QuotaPerUnit), hailuo.Quota)

	promptHubs, err := QuoteTaskUsageBilling("MiniMax-H3", "prompt-hubs", baseExpr, "", map[string]any{
		"seconds": float64(5), "resolution": "2K",
	}, 1)
	require.NoError(t, err)
	require.Len(t, promptHubs.Snapshot.Components, 1)
	assert.Equal(t, int(15*common.QuotaPerUnit), promptHubs.Quota)

	settlement, facts, components, err := EvaluateTaskCompletionUsageWithComponents(hailuo.Snapshot, map[string]any{
		"seconds":      float64(6),
		"input_images": float64(1),
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]any{
		"seconds":             float64(6),
		"resolution":          "2K",
		"input_images":        float64(1),
		"input_video_seconds": float64(15),
	}, facts)
	assert.Equal(t, int(134*common.QuotaPerUnit), settlement.ActualQuotaAfterGroup)
	require.Len(t, components, 2)
	assert.Equal(t, 18*common.QuotaPerUnit, components[0].ActualQuotaBeforeGroup)
	assert.Equal(t, 116*common.QuotaPerUnit, components[1].ActualQuotaBeforeGroup)
	assert.Equal(t, "2K", components[0].ActualTier)
	assert.Equal(t, "2K reference media", components[1].ActualTier)
}

func seedToken(t *testing.T, id int, userId int, key string, remainQuota int) {
	t.Helper()
	token := &model.Token{
		Id:          id,
		UserId:      userId,
		Key:         key,
		Name:        "test_token",
		Status:      common.TokenStatusEnabled,
		RemainQuota: remainQuota,
		UsedQuota:   0,
	}
	require.NoError(t, model.DB.Create(token).Error)
}

func seedSubscription(t *testing.T, id int, userId int, amountTotal int64, amountUsed int64) {
	t.Helper()
	sub := &model.UserSubscription{
		Id:          id,
		UserId:      userId,
		AmountTotal: amountTotal,
		AmountUsed:  amountUsed,
		Status:      "active",
		StartTime:   time.Now().Unix(),
		EndTime:     time.Now().Add(30 * 24 * time.Hour).Unix(),
	}
	require.NoError(t, model.DB.Create(sub).Error)
}

func seedChannel(t *testing.T, id int) {
	t.Helper()
	ch := &model.Channel{Id: id, Name: "test_channel", Key: "sk-test", Status: common.ChannelStatusEnabled}
	require.NoError(t, model.DB.Create(ch).Error)
}

func seedChargedAccounting(t *testing.T, userID, channelID, tokenID, quota, requestCount int) {
	t.Helper()
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", userID).Updates(map[string]any{
		"used_quota":    quota,
		"request_count": requestCount,
	}).Error)
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", channelID).
		Update("used_quota", quota).Error)
	if tokenID > 0 {
		require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", tokenID).
			Update("used_quota", quota).Error)
	}
}

func makeTask(userId, channelId, quota, tokenId int, billingSource string, subscriptionId int) *model.Task {
	return &model.Task{
		TaskID:    "task_" + time.Now().Format("150405.000"),
		UserId:    userId,
		ChannelId: channelId,
		Quota:     quota,
		Status:    model.TaskStatus(model.TaskStatusInProgress),
		Group:     "default",
		Data:      json.RawMessage(`{}`),
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
		Properties: model.Properties{
			OriginModelName: "test-model",
		},
		PrivateData: model.TaskPrivateData{
			BillingSource:  billingSource,
			SubscriptionId: subscriptionId,
			TokenId:        tokenId,
			BillingContext: &model.TaskBillingContext{
				ModelPrice:      0.02,
				GroupRatio:      1.0,
				OriginModelName: "test-model",
			},
		},
	}
}
