package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetSecurityIPRisksIncludesDuplicateRegistrationIPs(t *testing.T) {
	modelTestDBMutex.Lock()
	defer modelTestDBMutex.Unlock()

	previousDB, previousLogDB := DB, LOG_DB
	previousUsingSQLite := common.UsingSQLite
	previousUsingMySQL := common.UsingMySQL
	previousUsingPostgreSQL := common.UsingPostgreSQL
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&User{}, &AuditLog{}))
	DB, LOG_DB = database, database
	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.UsingSQLite = previousUsingSQLite
		common.UsingMySQL = previousUsingMySQL
		common.UsingPostgreSQL = previousUsingPostgreSQL
		if sqlDB, closeErr := database.DB(); closeErr == nil {
			_ = sqlDB.Close()
		}
	})

	users := []User{
		{Id: 501, Username: "risk-one", AffCode: "risk-one-code", RegisterIP: "203.0.113.50", CreatedAt: 100},
		{Id: 502, Username: "risk-two", AffCode: "risk-two-code", RegisterIP: "203.0.113.50", CreatedAt: 200},
		{Id: 503, Username: "ordinary", AffCode: "ordinary-code", RegisterIP: "203.0.113.51", CreatedAt: 300},
	}
	require.NoError(t, database.Create(&users).Error)
	require.NoError(t, database.Create(&AuditLog{
		EventId:   "security-event-1",
		UserId:    501,
		Username:  "risk-one",
		CreatedAt: 400,
		Category:  AuditCategoryLogin,
		Action:    "login",
		Ip:        "203.0.113.50",
		Success:   true,
	}).Error)

	risks, err := GetSecurityIPRisks(0, 0, 20)
	require.NoError(t, err)
	require.Len(t, risks, 1)
	assert.Equal(t, "203.0.113.50", risks[0].Address)
	assert.EqualValues(t, 2, risks[0].UserCount)
	assert.EqualValues(t, 1, risks[0].EventCount)
	assert.EqualValues(t, 400, risks[0].LastSeen)
}
