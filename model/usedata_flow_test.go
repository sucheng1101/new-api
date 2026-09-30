package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupFlowTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&QuotaData{}, &Token{}, &Channel{}))
	previousDB := DB
	previousGroupCol := commonGroupCol
	previousKeyCol := commonKeyCol
	DB = db
	commonGroupCol = "`group`"
	commonKeyCol = "`key`"
	t.Cleanup(func() {
		DB = previousDB
		commonGroupCol = previousGroupCol
		commonKeyCol = previousKeyCol
	})
	return db
}

func TestGetFlowQuotaDataKeepsRoutingDimensionsForAllScopes(t *testing.T) {
	db := setupFlowTestDB(t)
	token := Token{UserId: 7, Key: "flow-test-token", Name: "Primary token"}
	require.NoError(t, db.Create(&token).Error)
	require.NotZero(t, token.Id)
	channel := Channel{Key: "flow-test-channel-key", Name: "Primary channel"}
	require.NoError(t, db.Create(&channel).Error)
	require.NotZero(t, channel.Id)
	require.NoError(t, db.Create(&QuotaData{
		UserID: 7, Username: "flow-user", ModelName: "gpt-test", CreatedAt: 100,
		TokenUsed: 120, Count: 2, Quota: 300, Group: "default", TokenID: token.Id,
		ChannelID: channel.Id, NodeName: "node-a",
	}).Error)
	var tokenCheck Token
	require.NoError(t, db.First(&tokenCheck, token.Id).Error)
	require.Equal(t, token.Name, tokenCheck.Name)

	adminRows, err := GetFlowQuotaData(1, 200, "", 0, common.RoleAdminUser)
	require.NoError(t, err)
	require.Len(t, adminRows, 1)
	require.Equal(t, token.Id, adminRows[0].TokenID)
	require.Equal(t, token.Name, adminRows[0].TokenName)
	require.Equal(t, channel.Id, adminRows[0].ChannelID)
	require.Equal(t, channel.Name, adminRows[0].ChannelName)
	require.Equal(t, "node-a", adminRows[0].NodeName)

	selfRows, err := GetFlowQuotaData(1, 200, "", 7, common.RoleCommonUser)
	require.NoError(t, err)
	require.Len(t, selfRows, 1)
	require.Equal(t, token.Id, selfRows[0].TokenID)
	require.Equal(t, token.Name, selfRows[0].TokenName)
	require.Equal(t, channel.Id, selfRows[0].ChannelID)
	require.Equal(t, channel.Name, selfRows[0].ChannelName)
	require.Equal(t, "node-a", selfRows[0].NodeName)
}
