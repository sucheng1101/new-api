package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

// TaskPluginSourceArchive retains the exact executable source used by a task.
// It is content-addressed and shared by all tasks that used the same release.
// Deleting an installed plugin version therefore cannot silently change an
// existing task's polling or artifact protocol.
type TaskPluginSourceArchive struct {
	ID         int64  `json:"id"`
	Key        string `json:"key" gorm:"size:128;not null;uniqueIndex:uk_task_plugin_archive_source,priority:1"`
	Version    string `json:"version" gorm:"size:64;not null;uniqueIndex:uk_task_plugin_archive_source,priority:2"`
	SourceHash string `json:"source_hash" gorm:"size:64;not null;uniqueIndex:uk_task_plugin_archive_source,priority:3"`
	APIVersion int    `json:"api_version" gorm:"not null"`
	Source     string `json:"-" gorm:"type:text;not null"`
	CreatedAt  int64  `json:"created_at" gorm:"not null"`
}

// ArchiveTaskPluginSourceForTask writes the source release and task row in the
// same transaction. Legacy tasks without an in-memory source remain readable.
func ArchiveTaskPluginSourceForTask(tx *gorm.DB, task *Task) error {
	if tx == nil || task == nil || task.PrivateData.Execution == nil {
		return nil
	}
	snapshot := task.PrivateData.Execution.TaskPlugin
	if snapshot == nil {
		return nil
	}
	source := snapshot.archiveSourceForInsert()
	if source == "" {
		return nil
	}
	if strings.TrimSpace(snapshot.Key) == "" || strings.TrimSpace(snapshot.Version) == "" {
		return errors.New("task plugin archive is missing key or version")
	}
	digest := sha256.Sum256([]byte(source))
	actualHash := hex.EncodeToString(digest[:])
	if snapshot.SourceHash != "" && !strings.EqualFold(snapshot.SourceHash, actualHash) {
		return errors.New("task plugin archive source hash mismatch")
	}
	snapshot.SourceHash = actualHash

	archive := TaskPluginSourceArchive{
		Key:        snapshot.Key,
		Version:    snapshot.Version,
		SourceHash: actualHash,
		APIVersion: snapshot.APIVersion,
		Source:     source,
	}
	var existing TaskPluginSourceArchive
	err := tx.Where(&TaskPluginSourceArchive{
		Key: archive.Key, Version: archive.Version, SourceHash: archive.SourceHash,
	}).First(&existing).Error
	if err == nil {
		if existing.Source != archive.Source || existing.APIVersion != archive.APIVersion {
			return errors.New("task plugin archive identity conflicts with existing source")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	archive.CreatedAt = time.Now().Unix()
	return tx.Create(&archive).Error
}

func GetTaskPluginSourceArchive(key, version, sourceHash string) (*TaskPluginSourceArchive, error) {
	var archive TaskPluginSourceArchive
	if err := DB.Where(&TaskPluginSourceArchive{
		Key: key, Version: version, SourceHash: sourceHash,
	}).First(&archive).Error; err != nil {
		return nil, err
	}
	return &archive, nil
}
