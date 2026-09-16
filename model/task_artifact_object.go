package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TaskArtifactObject is the durable object reference for one generated task
// artifact. The bytes live in the configured object store; this row contains
// only the non-secret lookup metadata needed to serve them later.
type TaskArtifactObject struct {
	ID           int64  `json:"id"`
	TaskRecordID int64  `json:"task_record_id" gorm:"not null;uniqueIndex:uk_task_artifact_object,priority:1;index"`
	ArtifactKey  string `json:"artifact_key" gorm:"size:128;not null;uniqueIndex:uk_task_artifact_object,priority:2"`
	ArtifactType string `json:"artifact_type" gorm:"size:16;not null"`
	MimeType     string `json:"mime_type" gorm:"size:255"`
	Backend      string `json:"backend" gorm:"size:32;not null"`
	Bucket       string `json:"bucket" gorm:"size:255;not null"`
	ObjectKey    string `json:"object_key" gorm:"size:1024;not null"`
	ETag         string `json:"etag" gorm:"size:512"`
	Size         int64  `json:"size"`
	CreatedAt    int64  `json:"created_at" gorm:"not null"`
	UpdatedAt    int64  `json:"updated_at" gorm:"not null"`
}

func ListTaskArtifactObjects(task *Task) ([]TaskArtifactObject, error) {
	if task == nil || task.ID == 0 {
		return nil, nil
	}
	var objects []TaskArtifactObject
	err := DB.Where("task_record_id = ?", task.ID).Order("id ASC").Find(&objects).Error
	return objects, err
}

func GetTaskArtifactObject(task *Task, artifactKey string) (*TaskArtifactObject, error) {
	if task == nil || task.ID == 0 || strings.TrimSpace(artifactKey) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var object TaskArtifactObject
	err := DB.Where("task_record_id = ? AND artifact_key = ?", task.ID, artifactKey).First(&object).Error
	if err != nil {
		return nil, err
	}
	return &object, nil
}

// SaveTaskArtifactObject is idempotent for a task/artifact identity. Object
// keys are deterministic, so a retry may overwrite the same S3 object before
// this upsert safely refreshes its metadata.
func SaveTaskArtifactObject(object *TaskArtifactObject) error {
	if object == nil || object.TaskRecordID == 0 || strings.TrimSpace(object.ArtifactKey) == "" {
		return errors.New("task artifact object identity is required")
	}
	now := time.Now().Unix()
	if object.CreatedAt == 0 {
		object.CreatedAt = now
	}
	object.UpdatedAt = now
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "task_record_id"}, {Name: "artifact_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"artifact_type", "mime_type", "backend", "bucket", "object_key", "e_tag", "size", "updated_at",
		}),
	}).Create(object).Error
}
