package model

import (
	"crypto/sha256"
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTaskPluginArchiveTest(t *testing.T) {
	t.Helper()
	previousDB := DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Task{}, &TaskPluginSourceArchive{}))
	DB = database
	t.Cleanup(func() {
		DB = previousDB
		if sqlDB, closeErr := database.DB(); closeErr == nil {
			_ = sqlDB.Close()
		}
	})
}

func TestTaskInsertArchivesPluginSourceAtomically(t *testing.T) {
	setupTaskPluginArchiveTest(t)

	const source = `export const release = "historical-plugin-source";`
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(source)))
	snapshot := &TaskPluginSnapshot{
		Key:        "archive-test",
		Name:       "Archive Test",
		Version:    "1.0.0",
		APIVersion: 1,
		SourceHash: digest,
	}
	snapshot.SetArchiveSource(source)
	task := &Task{
		TaskID: "task_archive_test",
		Status: TaskStatusSubmitted,
		PrivateData: TaskPrivateData{
			Execution: &TaskExecutionSnapshot{TaskPlugin: snapshot},
		},
	}

	require.NoError(t, task.Insert())

	archive, err := GetTaskPluginSourceArchive("archive-test", "1.0.0", digest)
	require.NoError(t, err)
	assert.Equal(t, source, archive.Source)
	assert.Equal(t, 1, archive.APIVersion)

	var stored Task
	require.NoError(t, DB.First(&stored, task.ID).Error)
	require.NotNil(t, stored.PrivateData.Execution)
	require.NotNil(t, stored.PrivateData.Execution.TaskPlugin)
	assert.Equal(t, digest, stored.PrivateData.Execution.TaskPlugin.SourceHash)
	privateData, err := common.Marshal(stored.PrivateData)
	require.NoError(t, err)
	assert.NotContains(t, string(privateData), source)
}

func TestTaskInsertRejectsPluginSourceHashMismatchWithoutWritingTaskOrArchive(t *testing.T) {
	setupTaskPluginArchiveTest(t)

	snapshot := &TaskPluginSnapshot{
		Key:        "archive-mismatch",
		Name:       "Archive Mismatch",
		Version:    "1.0.0",
		APIVersion: 1,
		SourceHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}
	snapshot.SetArchiveSource(`export const release = "different";`)
	task := &Task{
		TaskID: "task_archive_mismatch",
		Status: TaskStatusSubmitted,
		PrivateData: TaskPrivateData{
			Execution: &TaskExecutionSnapshot{TaskPlugin: snapshot},
		},
	}

	err := task.Insert()
	require.ErrorContains(t, err, "source hash mismatch")

	var taskCount, archiveCount int64
	require.NoError(t, DB.Model(&Task{}).Count(&taskCount).Error)
	require.NoError(t, DB.Model(&TaskPluginSourceArchive{}).Count(&archiveCount).Error)
	assert.Zero(t, taskCount)
	assert.Zero(t, archiveCount)
}
