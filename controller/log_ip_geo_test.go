package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetLogIPGeoEnforcesLogVisibility(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedisEnabled := common.RedisEnabled
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	model.DB, model.LOG_DB = database, database
	common.RedisEnabled = false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedisEnabled
		_ = sqlDB.Close()
	})
	require.NoError(t, database.AutoMigrate(&model.User{}, &model.Log{}))
	require.NoError(t, database.Create(&[]model.User{
		{Id: 701, Username: "geo-enabled", AffCode: "geo-enabled", Setting: `{"record_ip_log":true}`},
		{Id: 702, Username: "geo-other", AffCode: "geo-other", Setting: `{"record_ip_log":true}`},
		{Id: 703, Username: "geo-disabled", AffCode: "geo-disabled", Setting: `{"record_ip_log":false}`},
	}).Error)
	require.NoError(t, database.Create(&[]model.Log{
		{UserId: 701, Type: model.LogTypeConsume, Ip: "10.1.1.1"},
		{UserId: 702, Type: model.LogTypeError, Ip: "10.1.1.2"},
		{UserId: 703, Type: model.LogTypeConsume, Ip: "10.1.1.3"},
		{UserId: 701, Type: model.LogTypeTopup, Ip: "10.1.1.4"},
	}).Error)

	gin.SetMode(gin.TestMode)
	lookup := func(userId, role int, ip string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/log/ip-geo?ip="+url.QueryEscape(ip), nil)
		ctx.Set("id", userId)
		ctx.Set("role", role)
		GetLogIPGeo(ctx)
		return recorder
	}
	decode := func(recorder *httptest.ResponseRecorder) (bool, string) {
		var result struct {
			Success bool `json:"success"`
			Data    struct {
				Status string `json:"status"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
		return result.Success, result.Data.Status
	}

	success, status := decode(lookup(701, common.RoleCommonUser, "10.1.1.1"))
	require.True(t, success)
	require.Equal(t, "private", status)

	success, _ = decode(lookup(701, common.RoleCommonUser, "10.1.1.2"))
	require.False(t, success)
	success, _ = decode(lookup(703, common.RoleCommonUser, "10.1.1.3"))
	require.False(t, success)
	success, status = decode(lookup(704, common.RoleAdminUser, "10.1.1.4"))
	require.True(t, success)
	require.Equal(t, "private", status)
	success, _ = decode(lookup(701, common.RoleCommonUser, "not-an-ip"))
	require.False(t, success)
}
