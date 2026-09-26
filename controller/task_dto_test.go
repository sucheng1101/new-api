package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskListDTOFlagsPluginArtifactWithoutExposingResultURL(t *testing.T) {
	task := &model.Task{
		TaskID: "task-plugin-video",
		Status: model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			ResultURL: "https://provider.example/video.mp4?signature=secret",
			Execution: &model.TaskExecutionSnapshot{
				TaskPlugin: &model.TaskPluginSnapshot{Key: "prompt-hubs"},
			},
		},
	}

	items := tasksToDto([]*model.Task{task}, false, common.RoleCommonUser)
	assert.Len(t, items, 1)
	assert.True(t, items[0].ArtifactAvailable)
	assert.Empty(t, items[0].ResultURL)
}

func TestTaskListDTOFlagsPluginArtifactWithoutResultURL(t *testing.T) {
	task := &model.Task{
		TaskID: "task-plugin-artifact-from-polling-state",
		Status: model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			Execution: &model.TaskExecutionSnapshot{
				TaskPlugin: &model.TaskPluginSnapshot{Key: "prompt-hubs"},
			},
		},
	}

	items := tasksToDto([]*model.Task{task}, false, common.RoleCommonUser)
	assert.Len(t, items, 1)
	assert.True(t, items[0].ArtifactAvailable)
	assert.Empty(t, items[0].ResultURL)
}

func TestTaskListDTOSeparatesUserAdminAndRootDetails(t *testing.T) {
	task := &model.Task{
		TaskID:    "task-role-projection",
		Platform:  "prompt-hubs",
		UserId:    17,
		Username:  "skye",
		Group:     "video",
		ChannelId: 52,
		Quota:     800000,
		Action:    constant.TaskActionTextToVideo,
		Status:    model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			Key:            "must-not-leak",
			UpstreamTaskID: "upstream-private-task",
			NodeName:       "node-task-a",
			Execution: &model.TaskExecutionSnapshot{
				RequestID:   "request-123",
				RequestPath: "/v1/videos",
				TaskPlugin: &model.TaskPluginSnapshot{
					Key:        "prompt-hubs",
					Name:       "Prompt Hubs Video",
					Version:    "1.0.0",
					APIVersion: 1,
					Generation: 42,
					Author: &model.TaskPluginAuthorSnapshot{
						Name: "Skye",
						URL:  "https://plugins.example/skye",
					},
				},
			},
		},
	}

	userView := tasksToDto([]*model.Task{task}, false, common.RoleCommonUser)[0]
	assert.Zero(t, userView.UserId)
	assert.Empty(t, userView.Username)
	assert.Zero(t, userView.ChannelId)
	assert.Empty(t, userView.Group)
	assert.Zero(t, userView.Quota)
	assert.Nil(t, userView.AdminInfo)
	assert.Nil(t, userView.RootInfo)
	assert.True(t, userView.ArtifactAvailable)
	assert.Empty(t, userView.ResultURL)
	userJSON, err := common.Marshal(userView)
	require.NoError(t, err)
	assert.NotContains(t, string(userJSON), "must-not-leak")
	assert.NotContains(t, string(userJSON), "upstream-private-task")
	assert.NotContains(t, string(userJSON), "\"user_id\"")
	assert.NotContains(t, string(userJSON), "\"channel_id\"")
	assert.NotContains(t, string(userJSON), "\"group\"")
	assert.NotContains(t, string(userJSON), "\"quota\"")

	adminView := tasksToDto([]*model.Task{task}, false, common.RoleAdminUser)[0]
	require.NotNil(t, adminView.AdminInfo)
	assert.Equal(t, 17, adminView.AdminInfo.UserID)
	assert.Equal(t, "skye", adminView.AdminInfo.Username)
	assert.Equal(t, 52, adminView.AdminInfo.ChannelID)
	assert.Equal(t, "video", adminView.AdminInfo.Group)
	assert.Equal(t, 800000, adminView.AdminInfo.Quota)
	assert.Equal(t, "request-123", adminView.AdminInfo.RequestID)
	assert.Equal(t, "/v1/videos", adminView.AdminInfo.RequestPath)
	require.NotNil(t, adminView.AdminInfo.TaskPlugin)
	assert.Equal(t, "prompt-hubs", adminView.AdminInfo.TaskPlugin.Key)
	assert.Equal(t, "Prompt Hubs Video", adminView.AdminInfo.TaskPlugin.Name)
	assert.Equal(t, "1.0.0", adminView.AdminInfo.TaskPlugin.Version)
	require.NotNil(t, adminView.AdminInfo.TaskPlugin.Author)
	assert.Equal(t, "Skye", adminView.AdminInfo.TaskPlugin.Author.Name)
	assert.Nil(t, adminView.RootInfo)
	adminJSON, err := common.Marshal(adminView)
	require.NoError(t, err)
	assert.NotContains(t, string(adminJSON), "must-not-leak")
	assert.NotContains(t, string(adminJSON), "upstream-private-task")

	rootView := tasksToDto([]*model.Task{task}, false, common.RoleRootUser)[0]
	require.NotNil(t, rootView.AdminInfo)
	require.NotNil(t, rootView.RootInfo)
	require.NotNil(t, rootView.RootInfo.TaskPlugin)
	assert.Equal(t, 1, rootView.RootInfo.TaskPlugin.APIVersion)
	assert.Equal(t, uint64(42), rootView.RootInfo.TaskPlugin.Generation)
	assert.Equal(t, "upstream-private-task", rootView.RootInfo.UpstreamTaskID)
	assert.Equal(t, "node-task-a", rootView.RootInfo.NodeName)
}
