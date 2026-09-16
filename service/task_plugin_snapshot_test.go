package service

import (
	"errors"
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTaskPluginSnapshotTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.TaskPlugin{}, &model.TaskPluginSourceArchive{}))
	model.DB = database
	t.Cleanup(func() {
		model.DB = previousDB
		if sqlDB, closeErr := database.DB(); closeErr == nil {
			_ = sqlDB.Close()
		}
	})
}

func snapshotPluginSource(key, version, marker string) string {
	return fmt.Sprintf(`
export const meta = {
  apiVersion: 1,
  key: %q,
  name: "Snapshot Test",
  version: %q,
  author: {name: "Test"},
  models: ["snapshot-model"],
  fetchMode: "per_task",
};
export function buildSubmitRequest() { return {url: "https://provider.example/submit", method: "POST", marker: %q}; }
export function parseSubmitResponse() { return {taskId: "provider-task"}; }
export function buildQueryRequest() { return {url: "https://provider.example/query", method: "GET"}; }
export function parseTaskResult() { return {status: "SUCCESS"}; }
`, key, version, marker)
}

func TestResolveTaskPluginSnapshotUsesArchivedReleaseAfterInstalledVersionIsDeleted(t *testing.T) {
	setupTaskPluginSnapshotTestDB(t)

	const (
		key     = "snapshot-archive"
		version = "1.0.0"
	)
	historicalSource := snapshotPluginSource(key, version, "historical")
	historicalHash := TaskPluginSourceHash(historicalSource)
	require.NoError(t, model.DB.Create(&model.TaskPluginSourceArchive{
		Key: key, Version: version, SourceHash: historicalHash, APIVersion: 1, Source: historicalSource,
	}).Error)

	// Simulate a normal update followed by deletion of the original installed
	// version. The archived release remains the only valid historical executor.
	currentSource := snapshotPluginSource(key, "1.0.1", "current")
	current := &model.TaskPlugin{
		Key: key, APIVersion: 1, Version: "1.0.1", Source: currentSource,
		SourceHash: TaskPluginSourceHash(currentSource), Enabled: true,
	}
	require.NoError(t, model.SaveTaskPlugin(current))

	resolved, err := ResolveTaskPluginSnapshot(&model.TaskPluginSnapshot{
		Key: key, Version: version, APIVersion: 1, SourceHash: historicalHash,
	})
	require.NoError(t, err)
	assert.Equal(t, version, resolved.Meta.Version)
	assert.Equal(t, historicalHash, resolved.SourceHash)
	assert.Contains(t, resolved.Source, "historical")
	assert.NotContains(t, resolved.Source, "current")
}

func TestResolveTaskPluginSnapshotWithMissingArchiveDoesNotFallForwardToCurrentPlugin(t *testing.T) {
	setupTaskPluginSnapshotTestDB(t)

	const (
		key     = "snapshot-missing"
		version = "1.0.0"
	)
	currentSource := snapshotPluginSource(key, version, "current")
	current := &model.TaskPlugin{
		Key: key, APIVersion: 1, Version: version, Source: currentSource,
		SourceHash: TaskPluginSourceHash(currentSource), Enabled: true,
	}
	require.NoError(t, model.SaveTaskPlugin(current))

	_, err := ResolveTaskPluginSnapshot(&model.TaskPluginSnapshot{
		Key: key, Version: version, APIVersion: 1,
		SourceHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrTaskPluginSnapshotUnavailable)
	assert.ErrorContains(t, err, "archived source not found")
}

func TestResolveTaskPluginSnapshotRejectsTamperedArchivedSource(t *testing.T) {
	setupTaskPluginSnapshotTestDB(t)

	const (
		key     = "snapshot-tampered"
		version = "1.0.0"
	)
	source := snapshotPluginSource(key, version, "tampered")
	wrongHash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	require.NoError(t, model.DB.Create(&model.TaskPluginSourceArchive{
		Key: key, Version: version, SourceHash: wrongHash, APIVersion: 1, Source: source,
	}).Error)

	_, err := ResolveTaskPluginSnapshot(&model.TaskPluginSnapshot{
		Key: key, Version: version, APIVersion: 1, SourceHash: wrongHash,
	})
	assert.Error(t, err)
	assert.True(t, errors.Is(err, ErrTaskPluginSnapshotUnavailable))
	assert.ErrorContains(t, err, "source hash does not match")
}
