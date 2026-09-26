package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/gin-gonic/gin"
)

// TaskExecutionSnapshotFromContext captures immutable request and plugin
// provenance at submission time. Source stays in an unexported field only
// until Task.InsertWithContext archives it alongside the task row.
func TaskExecutionSnapshotFromContext(ctx *gin.Context) *model.TaskExecutionSnapshot {
	if ctx == nil {
		return nil
	}
	snapshot := &model.TaskExecutionSnapshot{
		RequestID: ctx.GetString(common.RequestIdKey),
	}
	if ctx.Request != nil && ctx.Request.URL != nil {
		snapshot.RequestPath = ctx.Request.URL.Path
	}

	if plugin, generation := pinnedTaskPlugin(ctx); plugin != nil {
		generationNumber := uint64(0)
		if generation != nil {
			generationNumber = generation.Number
		}
		meta := plugin.Meta
		snapshot.TaskPlugin = &model.TaskPluginSnapshot{
			Key:        meta.Key,
			Name:       meta.Name,
			Version:    meta.Version,
			SourceHash: plugin.SourceHash,
			Author: &model.TaskPluginAuthorSnapshot{
				Name: meta.Author.Name,
				URL:  meta.Author.URL,
			},
			APIVersion: meta.APIVersion,
			Generation: generationNumber,
		}
		snapshot.TaskPlugin.SetArchiveSource(plugin.Source)
	}

	if snapshot.RequestID == "" && snapshot.RequestPath == "" && snapshot.TaskPlugin == nil {
		return nil
	}
	return snapshot
}

func pinnedTaskPlugin(ctx *gin.Context) (*pluginruntime.LoadedPlugin, *pluginruntime.RoutingGeneration) {
	if ctx == nil {
		return nil, nil
	}
	if value, exists := ctx.Get(pluginruntime.ContextKeyPinnedPlugin); exists {
		if pinned, ok := value.(pluginruntime.PinnedPlugin); ok && pinned.Plugin != nil {
			return pinned.Plugin, pinned.Generation
		}
	}
	if value, exists := ctx.Get(pluginruntime.ContextKeyPinnedEndpoint); exists {
		if pinned, ok := value.(pluginruntime.PinnedEndpoint); ok && pinned.Plugin != nil {
			return pinned.Plugin, pinned.Generation
		}
	}
	if value, exists := ctx.Get(pluginruntime.ContextKeyPinnedRoute); exists {
		if pinned, ok := value.(pluginruntime.PinnedRoute); ok && pinned.Plugin != nil {
			return pinned.Plugin, pinned.Generation
		}
	}
	return nil, nil
}

// AppendTaskPluginAuditInfo writes role-separated, credential-free plugin
// provenance into a usage log.
func AppendTaskPluginAuditInfo(other *model.LogOther, snapshot *model.TaskPluginSnapshot) {
	if other == nil || snapshot == nil || snapshot.Key == "" {
		return
	}
	taskPlugin := map[string]any{
		"key":     snapshot.Key,
		"name":    snapshot.Name,
		"version": snapshot.Version,
	}
	if snapshot.Author != nil && snapshot.Author.Name != "" {
		author := map[string]any{"name": snapshot.Author.Name}
		if snapshot.Author.URL != "" {
			author["url"] = snapshot.Author.URL
		}
		taskPlugin["author"] = author
	}
	other.SetAdmin("task_plugin", taskPlugin)
	other.SetRoot("task_plugin", map[string]any{
		"key":         snapshot.Key,
		"version":     snapshot.Version,
		"api_version": snapshot.APIVersion,
		"generation":  snapshot.Generation,
	})
}

// AppendTaskPluginContextAuditInfo is used before a task row exists, such as
// an upstream submission error log.
func AppendTaskPluginContextAuditInfo(ctx *gin.Context, other *model.LogOther) {
	execution := TaskExecutionSnapshotFromContext(ctx)
	if execution == nil {
		return
	}
	AppendTaskPluginAuditInfo(other, execution.TaskPlugin)
}
