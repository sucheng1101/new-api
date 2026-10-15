package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type setupStatusResponse struct {
	Success bool  `json:"success"`
	Data    Setup `json:"data"`
}

func setupSetupControllerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gin.SetMode(gin.TestMode)

	savedSQLite := common.UsingSQLite
	savedMySQL := common.UsingMySQL
	savedPostgreSQL := common.UsingPostgreSQL
	savedDB := model.DB
	t.Cleanup(func() {
		common.UsingSQLite = savedSQLite
		common.UsingMySQL = savedMySQL
		common.UsingPostgreSQL = savedPostgreSQL
		model.DB = savedDB
	})

	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.User{}))
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})

	return db
}

func callGetSetup(t *testing.T) setupStatusResponse {
	t.Helper()
	router := gin.New()
	router.GET("/setup", GetSetup)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/setup", nil)
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)

	var response setupStatusResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	return response
}

func TestGetSetupReportsRootInitAndDatabaseTypeWhenAlreadySetup(t *testing.T) {
	db := setupSetupControllerTestDB(t)

	savedSetup := constant.Setup
	t.Cleanup(func() { constant.Setup = savedSetup })
	constant.Setup = true

	response := callGetSetup(t)
	require.True(t, response.Data.Status)
	require.False(t, response.Data.RootInit)
	require.Equal(t, "sqlite", response.Data.DatabaseType)

	require.NoError(t, db.Create(&model.User{
		Username:    "root",
		Password:    "hashed-password",
		Role:        common.RoleRootUser,
		Status:      common.UserStatusEnabled,
		DisplayName: "Root User",
	}).Error)

	response = callGetSetup(t)
	require.True(t, response.Data.Status)
	require.True(t, response.Data.RootInit)
	require.Equal(t, "sqlite", response.Data.DatabaseType)
}
