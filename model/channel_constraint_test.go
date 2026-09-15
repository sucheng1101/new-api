package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTaskPluginIdentityFilterSeparatesSameModelChannels(t *testing.T) {
	alphaSetting := `{"task_plugin_key":"alpha"}`
	betaSetting := `{"task_plugin_key":"beta"}`

	alpha := &Channel{Id: 101, Type: constant.ChannelTypeTaskPlugin, Setting: &alphaSetting}
	beta := &Channel{Id: 102, Type: constant.ChannelTypeTaskPlugin, Setting: &betaSetting}
	filters := []dto.ChannelFilter{{
		Kind:          dto.FilterTaskPluginIdentity,
		TaskPluginKey: "alpha",
	}}

	assert.True(t, channelMatchesFilter(alpha, "shared", filters[0]))
	assert.False(t, channelMatchesFilter(beta, "shared", filters[0]))
	assert.True(t, func() bool {
		matched, _ := ChannelSatisfiesFilters(alpha, "shared", filters)
		return matched
	}())
	assert.False(t, func() bool {
		matched, _ := ChannelSatisfiesFilters(beta, "shared", filters)
		return matched
	}())
}

func TestTaskPluginIdentityFilterFiltersMemoryCacheCandidates(t *testing.T) {
	previous := channelsIDM
	channelsIDM = map[int]*Channel{}
	t.Cleanup(func() { channelsIDM = previous })

	alphaSetting := `{"task_plugin_key":"alpha"}`
	betaSetting := `{"task_plugin_key":"beta"}`
	channelsIDM[201] = &Channel{Id: 201, Type: constant.ChannelTypeTaskPlugin, Setting: &alphaSetting}
	channelsIDM[202] = &Channel{Id: 202, Type: constant.ChannelTypeTaskPlugin, Setting: &betaSetting}
	channelsIDM[203] = &Channel{Id: 203, Type: constant.ChannelTypeOpenAI}

	alphaOnly := filterCandidateIDs([]int{201, 202}, "shared", []dto.ChannelFilter{{
		Kind:          dto.FilterTaskPluginIdentity,
		TaskPluginKey: "alpha",
	}})
	assert.Equal(t, []int{201}, alphaOnly)

	ordinary := filterCandidateIDs([]int{203}, "ordinary", []dto.ChannelFilter{{
		Kind:                   dto.FilterTaskPluginIdentity,
		TaskPluginChannelTypes: []int{constant.ChannelTypeOpenAI},
	}})
	assert.Equal(t, []int{203}, ordinary)

	wrongPlugin := filterCandidateIDs([]int{201, 202}, "shared", []dto.ChannelFilter{{
		Kind:          dto.FilterTaskPluginIdentity,
		TaskPluginKey: "missing",
	}})
	assert.Empty(t, wrongPlugin)
}

func TestTaskPluginIdentityFilterKeepsLegacyChannelTypes(t *testing.T) {
	filter := dto.ChannelFilter{
		Kind:                   dto.FilterTaskPluginIdentity,
		TaskPluginKey:          "prompt-hubs",
		TaskPluginChannelTypes: []int{constant.ChannelTypeMiniMax},
	}

	legacy := &Channel{Type: constant.ChannelTypeMiniMax}
	other := &Channel{Type: constant.ChannelTypeKling}

	assert.True(t, channelMatchesFilter(legacy, "minimax_h3", filter))
	assert.False(t, channelMatchesFilter(other, "minimax_h3", filter))
}

func TestTaskPluginIdentityFilterAppliesBeforeDatabasePrioritySelection(t *testing.T) {
	modelTestDBMutex.Lock()
	defer modelTestDBMutex.Unlock()

	previousDB, previousLogDB := DB, LOG_DB
	previousUsingSQLite := common.UsingSQLite
	previousUsingMySQL := common.UsingMySQL
	previousUsingPostgreSQL := common.UsingPostgreSQL
	previousMemoryCache := common.MemoryCacheEnabled

	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Channel{}, &Ability{}))
	DB, LOG_DB = database, database
	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.UsingSQLite = previousUsingSQLite
		common.UsingMySQL = previousUsingMySQL
		common.UsingPostgreSQL = previousUsingPostgreSQL
		common.MemoryCacheEnabled = previousMemoryCache
		if sqlDB, closeErr := database.DB(); closeErr == nil {
			_ = sqlDB.Close()
		}
	})

	highPriority := int64(100)
	lowPriority := int64(1)
	weight := uint(1)
	baseURL := "https://plugin.example"
	alphaSetting := `{"task_plugin_key":"alpha"}`
	betaSetting := `{"task_plugin_key":"beta"}`
	channels := []*Channel{
		{Id: 301, Type: constant.ChannelTypeTaskPlugin, Key: "alpha-key", Status: common.ChannelStatusEnabled, Name: "alpha", Models: "shared", Group: "default", Priority: &lowPriority, Weight: &weight, BaseURL: &baseURL, Setting: &alphaSetting},
		{Id: 302, Type: constant.ChannelTypeTaskPlugin, Key: "beta-key", Status: common.ChannelStatusEnabled, Name: "beta", Models: "shared", Group: "default", Priority: &highPriority, Weight: &weight, BaseURL: &baseURL, Setting: &betaSetting},
	}
	for _, channel := range channels {
		require.NoError(t, database.Create(channel).Error)
		require.NoError(t, database.Create(&Ability{Group: "default", Model: "shared", ChannelId: channel.Id, Enabled: true, Priority: channel.Priority, Weight: uint(channel.GetWeight())}).Error)
	}

	selected, err := GetChannel("default", "shared", 0, []dto.ChannelFilter{{
		Kind:          dto.FilterTaskPluginIdentity,
		TaskPluginKey: "alpha",
	}})
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "alpha", selected.Name)

	selected, err = GetChannel("default", "shared", 0)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "beta", selected.Name)
}
