package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"gorm.io/gorm"
)

var ErrTaskPluginSnapshotUnavailable = errors.New("task plugin snapshot is unavailable")

var taskPluginSnapshotCache sync.Map // map[string]*pluginruntime.LoadedPlugin

// ResolveTaskPluginSnapshot reconstructs the exact plugin release that created
// a task. A task with a source hash never falls forward to the current active
// release: running a newer protocol against historical upstream state is worse
// than reporting that its archived release is unavailable.
func ResolveTaskPluginSnapshot(snapshot *model.TaskPluginSnapshot) (*pluginruntime.LoadedPlugin, error) {
	if snapshot == nil || strings.TrimSpace(snapshot.Key) == "" || strings.TrimSpace(snapshot.Version) == "" {
		return nil, fmt.Errorf("%w: missing plugin identity", ErrTaskPluginSnapshotUnavailable)
	}

	source, sourceHash, err := taskPluginSnapshotSource(snapshot)
	if err != nil {
		return nil, err
	}
	cacheKey := snapshot.Key + "\x00" + snapshot.Version + "\x00" + sourceHash
	if cached, found := taskPluginSnapshotCache.Load(cacheKey); found {
		if plugin, ok := cached.(*pluginruntime.LoadedPlugin); ok {
			return plugin, nil
		}
	}

	plugin, err := pluginruntime.CompilePlugin(source, pluginruntime.Options{
		Key:     snapshot.Key,
		Version: snapshot.Version,
	})
	if err != nil {
		return nil, fmt.Errorf("%w: compile archived plugin: %v", ErrTaskPluginSnapshotUnavailable, err)
	}
	if plugin.Meta.Key != snapshot.Key || plugin.Meta.Version != snapshot.Version ||
		(snapshot.APIVersion != 0 && plugin.Meta.APIVersion != snapshot.APIVersion) {
		return nil, fmt.Errorf("%w: archived plugin metadata does not match task snapshot", ErrTaskPluginSnapshotUnavailable)
	}
	if !strings.EqualFold(plugin.SourceHash, sourceHash) {
		return nil, fmt.Errorf("%w: archived plugin source hash does not match", ErrTaskPluginSnapshotUnavailable)
	}
	actual, _ := taskPluginSnapshotCache.LoadOrStore(cacheKey, plugin)
	return actual.(*pluginruntime.LoadedPlugin), nil
}

func taskPluginSnapshotSource(snapshot *model.TaskPluginSnapshot) (string, string, error) {
	if snapshot.SourceHash != "" {
		archive, err := model.GetTaskPluginSourceArchive(snapshot.Key, snapshot.Version, snapshot.SourceHash)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", "", fmt.Errorf("%w: archived source not found", ErrTaskPluginSnapshotUnavailable)
			}
			return "", "", fmt.Errorf("%w: load archived source: %v", ErrTaskPluginSnapshotUnavailable, err)
		}
		return archive.Source, archive.SourceHash, nil
	}

	// Pre-archive tasks can still use a retained database version. This is only
	// a compatibility bridge: it never selects the currently active version.
	if plugin, err := model.GetTaskPluginVersion(snapshot.Key, snapshot.Version); err == nil {
		return plugin.Source, plugin.SourceHash, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", "", fmt.Errorf("%w: load legacy plugin version: %v", ErrTaskPluginSnapshotUnavailable, err)
	}

	// Factory tasks created before source archives existed have no database row.
	// Reuse their installed source only when the manifest version is identical.
	if current, ok := pluginruntime.DefaultRegistry.Generation().Get(snapshot.Key); ok &&
		current.Meta.Version == snapshot.Version &&
		(snapshot.APIVersion == 0 || current.Meta.APIVersion == snapshot.APIVersion) {
		return current.Source, current.SourceHash, nil
	}
	return "", "", fmt.Errorf("%w: legacy source release not found", ErrTaskPluginSnapshotUnavailable)
}

// TaskPluginSourceHash returns the canonical hash used by task source archives.
// It is kept here for tests that need to build a snapshot without a live HTTP
// request context.
func TaskPluginSourceHash(source string) string {
	digest := sha256.Sum256([]byte(source))
	return hex.EncodeToString(digest[:])
}
