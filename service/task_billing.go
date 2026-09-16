package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"maps"
	"math"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// LogTaskConsumption 记录任务消费日志和统计信息（仅记录，不涉及实际扣费）。
// 实际扣费已由 BillingSession（PreConsumeBilling + SettleBilling）完成。
func LogTaskConsumption(c *gin.Context, info *relaycommon.RelayInfo, task *model.Task) (time.Time, int) {
	usageRecordedAt := time.Now() // Skye：渠道账本记账时间
	tokenName := c.GetString("token_name")
	logContent := fmt.Sprintf("操作 %s", info.Action)
	// 支持任务仅按次计费
	if common.StringsContains(constant.TaskPricePatches, info.OriginModelName) {
		logContent = fmt.Sprintf("%s，按次计费", logContent)
	} else {
		var contents []string
		if otherRatios := info.PriceData.OtherRatios(); len(otherRatios) > 0 {
			for key, ra := range otherRatios {
				if 1.0 != ra {
					contents = append(contents, fmt.Sprintf("%s: %.2f", key, ra))
				}
			}
		}
		if snap := info.TieredBillingSnapshot; snap != nil {
			for key, value := range snap.UsageFacts {
				contents = append(contents, fmt.Sprintf("%s: %v", key, value))
			}
		}
		if len(contents) > 0 {
			logContent = fmt.Sprintf("%s, 计算参数：%s", logContent, strings.Join(contents, ", "))
		}
	}
	other := model.NewLogOther()
	other.SetPublic("is_task", true)
	other.SetPublic("request_path", c.Request.URL.Path)
	other.SetPublic("model_price", info.PriceData.ModelPrice)
	if info.PriceData.ModelRatio > 0 {
		other.SetPublic("model_ratio", info.PriceData.ModelRatio)
	}
	other.SetPublic("group_ratio", info.PriceData.GroupRatioInfo.GroupRatio)
	if info.PriceData.GroupRatioInfo.HasSpecialRatio {
		other.SetPublic("user_group_ratio", info.PriceData.GroupRatioInfo.GroupSpecialRatio)
	}
	if info.IsModelMapped {
		other.SetPublic("is_model_mapped", true)
		other.SetPublic("upstream_model_name", info.UpstreamModelName)
	}
	appendTieredTaskBillingOther(other, info.TieredBillingSnapshot)
	appendTaskLogInfo(task, other)
	attachQuotaSaturation(c, info, other)
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{
		ChannelId: info.ChannelId,
		ModelName: info.OriginModelName,
		TokenName: tokenName,
		Quota:     info.PriceData.Quota,
		Content:   logContent,
		TokenId:   info.TokenId,
		Group:     info.UsingGroup,
		Other:     other.Snapshot(), // Fork：RecordConsumeLog 的 Other 仍为 map
	})
	model.UpdateUserUsedQuotaAndRequestCount(info.UserId, info.PriceData.Quota)
	standardQuota := standardTaskQuotaEstimate(info) // Skye：渠道标准口径账本替代 UpdateChannelUsedQuota
	if err := RecordRelayChannelUsageAt(info, info.PriceData.Quota, standardQuota, 0, 1, usageRecordedAt); err != nil {
		logger.LogError(c, "error recording channel usage: "+err.Error())
	}
	return usageRecordedAt, standardQuota
}

// standardTaskQuotaEstimate 估算任务预扣的标准口径用量（不含分组倍率）。（Skye）
// 分组倍率 > 0 时按计费额反推；分组倍率为 0 且按次计费时取模型原始单价；
// 其余情况（分组倍率为 0 且按倍率计费）预扣计费额本身为 0，记 0，
// 任务完成按 token 重算时会补记标准口径差额。
func standardTaskQuotaEstimate(info *relaycommon.RelayInfo) int {
	groupRatio := info.PriceData.GroupRatioInfo.GroupRatio
	if groupRatio > 0 {
		return int(math.Round(float64(info.PriceData.Quota) / groupRatio))
	}
	if info.PriceData.UsePrice && info.PriceData.ModelPrice > 0 {
		return int(math.Round(info.PriceData.ModelPrice * common.QuotaPerUnit))
	}
	return 0
}

// ---------------------------------------------------------------------------
// 异步任务计费辅助函数
// ---------------------------------------------------------------------------

// resolveTokenKey 通过 TokenId 运行时获取令牌 Key（用于 Redis 缓存操作）。
// 如果令牌已被删除或查询失败，返回空字符串。
func resolveTokenKey(ctx context.Context, tokenId int, taskID string) string {
	token, err := model.GetTokenById(tokenId)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("获取令牌 key 失败 (tokenId=%d, task=%s): %s", tokenId, taskID, err.Error()))
		return ""
	}
	return token.Key
}

// taskIsSubscription 判断任务是否通过订阅计费。
func taskIsSubscription(task *model.Task) bool {
	return task.PrivateData.BillingSource == BillingSourceSubscription && task.PrivateData.SubscriptionId > 0
}

// taskAdjustFunding 调整任务的资金来源（钱包或订阅），delta > 0 表示扣费，delta < 0 表示退还。
func taskAdjustFunding(task *model.Task, delta int) error {
	if taskIsSubscription(task) {
		return model.PostConsumeUserSubscriptionDelta(task.PrivateData.SubscriptionId, int64(delta))
	}
	if delta > 0 {
		return model.DecreaseUserQuota(task.UserId, delta, false)
	}
	return model.IncreaseUserQuota(task.UserId, -delta, false)
}

// taskAdjustTokenQuota 调整任务的令牌额度，delta > 0 表示扣费，delta < 0 表示退还。
// 需要通过 resolveTokenKey 运行时获取 key（不从 PrivateData 中读取）。
func taskAdjustTokenQuota(ctx context.Context, task *model.Task, delta int) {
	if task.PrivateData.TokenId <= 0 || delta == 0 {
		return
	}
	tokenKey := resolveTokenKey(ctx, task.PrivateData.TokenId, task.TaskID)
	if tokenKey == "" {
		return
	}
	var err error
	if delta > 0 {
		err = model.DecreaseTokenQuota(task.PrivateData.TokenId, tokenKey, delta)
	} else {
		err = model.IncreaseTokenQuota(task.PrivateData.TokenId, tokenKey, -delta)
	}
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("调整令牌额度失败 (delta=%d, task=%s): %s", delta, task.TaskID, err.Error()))
	}
}

// taskBillingOther 从 task 的 BillingContext 构建日志 Other 字段。
func taskBillingOther(task *model.Task) *model.LogOther {
	other := model.NewLogOther()
	if bc := task.PrivateData.BillingContext; bc != nil {
		other.SetPublic("model_price", bc.ModelPrice)
		if bc.ModelRatio > 0 {
			other.SetPublic("model_ratio", bc.ModelRatio)
		}
		other.SetPublic("group_ratio", bc.GroupRatio)
		if priceData := taskBillingContextPriceData(bc); priceData != nil {
			for k, v := range priceData.OtherRatios() {
				if !other.SetPublic(k, v) {
					common.SysError("task billing other ratio key rejected: " + k)
				}
			}
		}
		appendTieredTaskBillingOther(other, bc.TieredSnapshot)
	}
	props := task.Properties
	if props.UpstreamModelName != "" && props.UpstreamModelName != props.OriginModelName {
		other.SetPublic("is_model_mapped", true)
		other.SetPublic("upstream_model_name", props.UpstreamModelName)
	}
	appendTaskLogInfo(task, other)
	return other
}

func appendTieredTaskBillingOther(other *model.LogOther, snap *billingexpr.BillingSnapshot) {
	if other == nil || snap == nil {
		return
	}
	other.SetPublic("billing_mode", "tiered_expr")
	other.SetPublic("expr_b64", base64.StdEncoding.EncodeToString([]byte(snap.ExprString)))
	other.SetPublic("matched_tier", snap.EstimatedTier)
	if len(snap.UsageFacts) > 0 {
		other.SetPublic("usage_facts", snap.UsageFacts)
	}
	if len(snap.Components) == 0 {
		return
	}
	components := make([]map[string]any, 0, len(snap.Components))
	for _, component := range snap.Components {
		entry := map[string]any{
			"kind":                         component.Kind,
			"estimated_quota_before_group": component.EstimatedQuotaBeforeGroup,
		}
		if component.PluginKey != "" {
			entry["plugin_key"] = component.PluginKey
		}
		if component.EstimatedTier != "" {
			entry["estimated_tier"] = component.EstimatedTier
		}
		if component.ActualTier != "" {
			entry["actual_tier"] = component.ActualTier
			entry["actual_quota_before_group"] = component.ActualQuotaBeforeGroup
		}
		components = append(components, entry)
	}
	other.SetPublic("billing_components", components)
}

func appendTaskLogInfo(task *model.Task, other *model.LogOther) {
	if task == nil || other == nil {
		return
	}
	if task.TaskID != "" {
		other.SetPublic("task_id", task.TaskID)
	}
	if task.PrivateData.Execution != nil {
		AppendTaskPluginAuditInfo(other, task.PrivateData.Execution.TaskPlugin)
	}
	if task.PrivateData.UpstreamTaskID == "" && task.PrivateData.NodeName == "" {
		return
	}
	if task.PrivateData.UpstreamTaskID != "" {
		other.SetRoot("upstream_task_id", task.PrivateData.UpstreamTaskID)
	}
	if task.PrivateData.NodeName != "" {
		other.SetRoot("node_name", task.PrivateData.NodeName)
	}
}

func taskBillingContextPriceData(bc *model.TaskBillingContext) *types.PriceData {
	if bc == nil || len(bc.OtherRatios) == 0 {
		return nil
	}
	priceData := &types.PriceData{}
	if !priceData.ReplaceOtherRatios(bc.OtherRatios) {
		return nil
	}
	return priceData
}

// taskModelName 从 BillingContext 或 Properties 中获取模型名称。
func taskModelName(task *model.Task) string {
	if bc := task.PrivateData.BillingContext; bc != nil && bc.OriginModelName != "" {
		return bc.OriginModelName
	}
	return task.Properties.OriginModelName
}

// taskChannelUsageTime 返回渠道账本回冲时间（优先记录的记账时间，其次提交时间）。（Skye）
func taskChannelUsageTime(task *model.Task) time.Time {
	if task.PrivateData.ChannelUsageRecordedAt > 0 {
		return time.Unix(task.PrivateData.ChannelUsageRecordedAt, 0)
	}
	if task.SubmitTime > 0 {
		return time.Unix(task.SubmitTime, 0)
	}
	return time.Now()
}

// taskAdjustChannelUsage 对渠道、密钥与渠道日账本做差额回冲。（Skye）
func taskAdjustChannelUsage(ctx context.Context, task *model.Task, quotaDelta int, standardQuotaDelta int, tokenUsedDelta int64) {
	if task == nil || task.ChannelId <= 0 || (quotaDelta == 0 && standardQuotaDelta == 0 && tokenUsedDelta == 0) {
		return
	}
	err := RecordChannelUsageDelta(ChannelUsageDeltaRecordParams{
		ChannelID:          task.ChannelId,
		KeyFingerprint:     task.PrivateData.ChannelKeyFingerprint,
		KeyIndex:           task.PrivateData.ChannelKeyIndex,
		HasKeyIdentity:     strings.TrimSpace(task.PrivateData.ChannelKeyFingerprint) != "",
		QuotaDelta:         quotaDelta,
		StandardQuotaDelta: int64(standardQuotaDelta),
		TokenUsedDelta:     tokenUsedDelta,
		Now:                taskChannelUsageTime(task),
	})
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("adjust channel usage failed (task=%s, quota_delta=%d, token_delta=%d): %s", task.TaskID, quotaDelta, tokenUsedDelta, err.Error()))
	}
}

// RefundTaskQuota 统一的任务失败退款逻辑。
// 当异步任务失败时，退还资金与令牌额度，并回减用户和渠道用量。
// 返回资金来源是否已成功退还；失败时保留 quota，供显式重试或人工对账。
func RefundTaskQuota(ctx context.Context, task *model.Task, reason string) bool {
	quota := task.Quota
	if quota == 0 {
		return true
	}

	// 1. 退还资金来源（钱包或订阅）
	if err := taskAdjustFunding(task, -quota); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("退还资金来源失败 task %s: %s", task.TaskID, err.Error()))
		return false
	}

	// 2. 退还令牌额度
	taskAdjustTokenQuota(ctx, task, -quota)

	// 3. 回减预扣时累计的用户用量；渠道账本由 Skye 渠道账本统一回冲，请求次数保持不变
	model.UpdateUserUsedQuota(task.UserId, -quota)
	// Skye：回冲渠道、密钥和渠道日报中的预扣额度
	taskAdjustChannelUsage(ctx, task, -quota, -task.PrivateData.ChannelStandardQuota, 0)

	// 4. 记录日志
	other := taskBillingOther(task)
	other.SetPublic("task_id", task.TaskID)
	other.SetPublic("reason", reason)
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
		UserId:    task.UserId,
		LogType:   model.LogTypeRefund,
		Content:   "",
		ChannelId: task.ChannelId,
		ModelName: taskModelName(task),
		Quota:     quota,
		TokenId:   task.PrivateData.TokenId,
		Group:     task.Group,
		Other:     other,
	})

	// 5. 资金退款完成后再清除持久化标记。
	// 回写失败必须显式告警，避免漏掉潜在的重复退款风险。
	if err := task.UpdateQuota(0); err != nil { // Skye：带参落库
		logger.LogError(ctx, fmt.Sprintf("退款成功但清除 task quota 失败 task %s: %s", task.TaskID, err.Error()))
	}
	return true
}

// RecalculateTaskQuota 通用的异步差额结算。
// actualQuota 是任务完成后的实际应扣额度，与预扣额度 (task.Quota) 做差额结算。
// reason 用于日志记录（例如 "token重算" 或 "adaptor调整"）。
// clamps 可选：若计算 actualQuota 时发生额度饱和，将其记入日志 admin_info（仅管理员可见）。
// standardActualQuota 为渠道限额标准口径（不含分组倍率）的实际额度。（Skye 增参）
func RecalculateTaskQuota(ctx context.Context, task *model.Task, actualQuota int, standardActualQuota int, reason string, clamps ...*common.QuotaClamp) {
	if actualQuota < 0 {
		return
	}
	preConsumedQuota := task.Quota
	quotaDelta := actualQuota - preConsumedQuota
	standardQuotaDelta := standardActualQuota - task.PrivateData.ChannelStandardQuota // Skye

	if quotaDelta == 0 && standardQuotaDelta == 0 {
		logger.LogInfo(ctx, fmt.Sprintf("任务 %s 预扣费准确（%s，%s）",
			task.TaskID, logger.LogQuota(actualQuota), reason))
		return
	}

	if quotaDelta == 0 {
		// 计费口径无差额：仅静默回写标准口径账本差异，不产生用户侧资金与日志变化。（Skye）
		taskAdjustChannelUsage(ctx, task, 0, standardQuotaDelta, 0)
		return
	}

	logger.LogInfo(ctx, fmt.Sprintf("任务 %s 差额结算：delta=%s（实际：%s，预扣：%s，%s）",
		task.TaskID,
		logger.LogQuota(quotaDelta),
		logger.LogQuota(actualQuota),
		logger.LogQuota(preConsumedQuota),
		reason,
	))

	// 调整资金来源
	if err := taskAdjustFunding(task, quotaDelta); err != nil {
		logger.LogError(ctx, fmt.Sprintf("差额结算资金调整失败 task %s: %s", task.TaskID, err.Error()))
		return
	}

	// 调整令牌额度
	taskAdjustTokenQuota(ctx, task, quotaDelta)

	// 渠道账本按最终计费额度做相同的正负差额结算，Token 统计独立处理。（Skye）
	taskAdjustChannelUsage(ctx, task, quotaDelta, standardQuotaDelta, 0)

	if err := task.UpdateQuota(actualQuota); err != nil { // Skye：带参落库
		logger.LogError(ctx, fmt.Sprintf("差额结算回写 quota 失败 task %s: %s", task.TaskID, err.Error()))
	}

	// 提交阶段已经累计过一次请求；结算阶段只调整最终用量。
	model.UpdateUserUsedQuota(task.UserId, quotaDelta)

	var logType int
	var logQuota int
	if quotaDelta > 0 {
		logType = model.LogTypeConsume
		logQuota = quotaDelta
	} else {
		logType = model.LogTypeRefund
		logQuota = -quotaDelta
	}
	other := taskBillingOther(task)
	other.SetPublic("task_id", task.TaskID)
	other.SetPublic("pre_consumed_quota", preConsumedQuota)
	other.SetPublic("actual_quota", actualQuota)
	for _, clamp := range clamps {
		attachQuotaSaturationToOther(other, clamp)
	}
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
		UserId:    task.UserId,
		LogType:   logType,
		Content:   reason,
		ChannelId: task.ChannelId,
		ModelName: taskModelName(task),
		Quota:     logQuota,
		TokenId:   task.PrivateData.TokenId,
		Group:     task.Group,
		Other:     other,
		NodeName:  task.PrivateData.NodeName,
	})
}

// RecalculateTaskQuotaByTokens 根据实际 token 消耗重新计费（异步差额结算）。
// 当任务成功且返回了 totalTokens 时，根据模型倍率和分组倍率重新计算实际扣费额度，
// 与预扣费的差额进行补扣或退还。支持钱包和订阅计费来源。
func RecalculateTaskQuotaByTokens(ctx context.Context, task *model.Task, totalTokens int) bool {
	if totalTokens <= 0 {
		return false
	}

	modelName := taskModelName(task)

	// 获取模型价格和倍率
	modelRatio, hasRatioSetting, _ := ratio_setting.GetModelRatio(modelName)
	// 只有配置了倍率(非固定价格)时才按 token 重新计费
	if !hasRatioSetting || modelRatio <= 0 {
		return false
	}

	// 获取用户和组的倍率信息
	group := task.Group
	if group == "" {
		user, err := model.GetUserById(task.UserId, false)
		if err == nil {
			group = user.Group
		}
	}
	if group == "" {
		return false
	}

	groupRatio := ratio_setting.GetGroupRatio(group)
	userGroupRatio, hasUserGroupRatio := ratio_setting.GetGroupGroupRatio(group, group)

	var finalGroupRatio float64
	if hasUserGroupRatio {
		finalGroupRatio = userGroupRatio
	} else {
		finalGroupRatio = groupRatio
	}

	// 计算 OtherRatios 乘积（视频折扣、时长等）
	otherMultiplier := 1.0
	if priceData := taskBillingContextPriceData(task.PrivateData.BillingContext); priceData != nil {
		otherMultiplier = priceData.OtherRatioMultiplier()
	}

	// 计算实际应扣费额度: totalTokens * modelRatio * groupRatio * otherMultiplier（饱和转换，防止溢出成负数）
	actualQuota, clamp := common.QuotaFromFloatChecked(float64(totalTokens) * modelRatio * finalGroupRatio * otherMultiplier)
	// 标准口径（不含分组倍率）：totalTokens * modelRatio * otherMultiplier（Skye）
	standardActualQuota, _ := common.QuotaFromFloatChecked(float64(totalTokens) * modelRatio * otherMultiplier)

	reason := fmt.Sprintf("token重算：tokens=%d, modelRatio=%.2f, groupRatio=%.2f, otherMultiplier=%.4f", totalTokens, modelRatio, finalGroupRatio, otherMultiplier)
	RecalculateTaskQuota(ctx, task, actualQuota, standardActualQuota, reason, clamp)
	return true
}

// TaskUsageBillingQuote is the frozen result of evaluating public task pricing
// plus an optional selected-plugin surcharge at submission time.
type TaskUsageBillingQuote struct {
	Snapshot *billingexpr.BillingSnapshot
	Quota    int
	Clamp    *common.QuotaClamp
}

// QuoteTaskUsageBilling evaluates the public model expression and the selected
// plugin's additive expression independently, then applies the group ratio and
// rounding once to their sum. The expressions are retained as separate frozen
// components for completion settlement and audit logs.
func QuoteTaskUsageBilling(modelName, pluginKey, baseExpr, addonExpr string, facts map[string]any, groupRatio float64) (TaskUsageBillingQuote, error) {
	if billingexpr.UsesFixedPricing(baseExpr) {
		return TaskUsageBillingQuote{}, fmt.Errorf("fixed pricing is not supported for task usage expressions")
	}
	components := make([]billingexpr.BillingComponentSnapshot, 0, 2)
	base, err := quoteTaskUsageBillingComponent("base", "", baseExpr, facts)
	if err != nil {
		return TaskUsageBillingQuote{}, err
	}
	components = append(components, base)
	totalBeforeGroup := base.EstimatedQuotaBeforeGroup
	if addonExpr != "" {
		if billingexpr.UsesFixedPricing(addonExpr) {
			return TaskUsageBillingQuote{}, fmt.Errorf("fixed pricing is not supported for task usage expressions")
		}
		addon, err := quoteTaskUsageBillingComponent("plugin_addon", pluginKey, addonExpr, facts)
		if err != nil {
			return TaskUsageBillingQuote{}, err
		}
		components = append(components, addon)
		totalBeforeGroup += addon.EstimatedQuotaBeforeGroup
	}
	quota, clamp := common.QuotaRoundChecked(totalBeforeGroup * groupRatio)
	snapshot := &billingexpr.BillingSnapshot{
		BillingMode:               "tiered_expr",
		ModelName:                 modelName,
		ExprString:                base.ExprString,
		ExprHash:                  base.ExprHash,
		GroupRatio:                groupRatio,
		EstimatedQuotaBeforeGroup: totalBeforeGroup,
		EstimatedQuotaAfterGroup:  quota,
		EstimatedTier:             base.EstimatedTier,
		QuotaPerUnit:              common.QuotaPerUnit,
		ExprVersion:               base.ExprVersion,
		TaskUsageBilling:          true,
		UsageFacts:                maps.Clone(facts),
		Components:                components,
	}
	return TaskUsageBillingQuote{Snapshot: snapshot, Quota: quota, Clamp: clamp}, nil
}

func quoteTaskUsageBillingComponent(kind, pluginKey, expression string, facts map[string]any) (billingexpr.BillingComponentSnapshot, error) {
	cost, trace, err := billingexpr.RunExprWithRequest(expression, billingexpr.TokenParams{}, billingexpr.RequestInput{Usage: facts})
	if err != nil {
		return billingexpr.BillingComponentSnapshot{}, err
	}
	if cost < 0 || math.IsNaN(cost) || math.IsInf(cost, 0) {
		return billingexpr.BillingComponentSnapshot{}, fmt.Errorf("task usage expression produced an invalid cost")
	}
	return billingexpr.BillingComponentSnapshot{
		Kind:                      kind,
		PluginKey:                 pluginKey,
		ExprString:                expression,
		ExprHash:                  billingexpr.ExprHashString(expression),
		ExprVersion:               billingexpr.ExprVersion(expression),
		EstimatedQuotaBeforeGroup: cost * common.QuotaPerUnit,
		EstimatedTier:             trace.MatchedTier,
	}, nil
}

// EvaluateTaskCompletionUsage evaluates actual facts against frozen task
// expressions. It keeps the historical return shape for existing callers that
// only need the total result.
func EvaluateTaskCompletionUsage(snap *billingexpr.BillingSnapshot, facts map[string]any) (billingexpr.TieredResult, map[string]any, error) {
	result, usage, _, err := EvaluateTaskCompletionUsageWithComponents(snap, facts)
	return result, usage, err
}

// EvaluateTaskCompletionUsageWithComponents returns each settled contribution
// in addition to the total. A snapshot without components is evaluated through
// the legacy single-expression path so existing in-flight tasks stay stable.
func EvaluateTaskCompletionUsageWithComponents(snap *billingexpr.BillingSnapshot, facts map[string]any) (billingexpr.TieredResult, map[string]any, []billingexpr.BillingComponentSnapshot, error) {
	if snap == nil {
		return billingexpr.TieredResult{}, nil, nil, fmt.Errorf("task billing snapshot is missing")
	}
	usage := make(map[string]any, len(snap.UsageFacts)+len(facts))
	maps.Copy(usage, snap.UsageFacts)
	maps.Copy(usage, facts)
	if len(snap.Components) == 0 {
		result, err := billingexpr.ComputeTieredQuotaWithRequest(snap, billingexpr.TokenParams{}, billingexpr.RequestInput{Usage: usage})
		if err == nil && (result.ActualQuotaBeforeGroup < 0 || math.IsNaN(result.ActualQuotaBeforeGroup)) {
			err = fmt.Errorf("task completion expression produced an invalid cost")
		}
		return result, usage, nil, err
	}

	components := make([]billingexpr.BillingComponentSnapshot, len(snap.Components))
	copy(components, snap.Components)
	totalBeforeGroup := 0.0
	baseTier := ""
	for index := range components {
		component := &components[index]
		if component.ExprString == "" || billingexpr.UsesFixedPricing(component.ExprString) {
			return billingexpr.TieredResult{}, usage, nil, fmt.Errorf("task billing component %q is invalid", component.Kind)
		}
		cost, trace, err := billingexpr.RunExprByHashWithRequest(component.ExprString, component.ExprHash, billingexpr.TokenParams{}, billingexpr.RequestInput{Usage: usage})
		if err != nil {
			return billingexpr.TieredResult{}, usage, nil, err
		}
		if cost < 0 || math.IsNaN(cost) || math.IsInf(cost, 0) {
			return billingexpr.TieredResult{}, usage, nil, fmt.Errorf("task completion expression produced an invalid cost")
		}
		component.ActualQuotaBeforeGroup = cost * snap.QuotaPerUnit
		component.ActualTier = trace.MatchedTier
		totalBeforeGroup += component.ActualQuotaBeforeGroup
		if component.Kind == "base" {
			baseTier = trace.MatchedTier
		}
	}
	quota, clamp := common.QuotaRoundChecked(totalBeforeGroup * snap.GroupRatio)
	return billingexpr.TieredResult{
		ActualQuotaBeforeGroup: totalBeforeGroup,
		ActualQuotaAfterGroup:  quota,
		MatchedTier:            baseTier,
		CrossedTier:            baseTier != snap.EstimatedTier,
		Clamp:                  clamp,
	}, usage, components, nil
}
