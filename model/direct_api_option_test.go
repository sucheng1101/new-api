package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupDirectAPIOptionTest(t *testing.T) {
	t.Helper()
	previousDB := DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&Option{}))
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	DB = database
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
}

func TestUpdateDirectAPIEndpointsPersistsJSONAndIsIdempotent(t *testing.T) {
	setupDirectAPIOptionTest(t)

	endpoints := []common.DirectAPIEndpoint{{
		Name:        "Primary",
		Endpoint:    "https://api.example.com/v1/",
		Description: "main endpoint",
		Enabled:     true,
		SortOrder:   2,
	}}
	require.NoError(t, UpdateDirectAPIEndpoints(endpoints))
	require.NoError(t, UpdateDirectAPIEndpoints(endpoints))

	var option Option
	require.NoError(t, DB.Where("key = ?", "DirectAPIEndpoints").First(&option).Error)
	var configured Option
	require.NoError(t, DB.Where("key = ?", "DirectAPIEndpointsConfigured").First(&configured).Error)
	require.Equal(t, "true", configured.Value)
	decoded := common.DirectAPIEndpoints()
	require.Len(t, decoded, 1)
	require.Equal(t, 1, decoded[0].ID)
	require.Equal(t, "https://api.example.com/v1", decoded[0].Endpoint)
	require.NotEmpty(t, option.Value)
}

func TestUpdateDirectAPIConfigPreservesExistingEndpoints(t *testing.T) {
	setupDirectAPIOptionTest(t)
	endpoints := []common.DirectAPIEndpoint{{Name: "Primary", Endpoint: "https://api.example.com/v1", Enabled: true}}
	require.NoError(t, UpdateDirectAPIConfig("api.example.com", "https://api.example.com", endpoints))
	require.NoError(t, UpdateDirectAPIConfig("api2.example.com", "https://api2.example.com"))

	records := common.DirectAPIEndpoints()
	var hosts, baseURLs, endpointNames []string
	for _, record := range records {
		switch common.DirectAPIRecordKind(record) {
		case common.DirectAPIRecordKindHost:
			hosts = append(hosts, record.Endpoint)
		case common.DirectAPIRecordKindBaseURL:
			baseURLs = append(baseURLs, record.Endpoint)
		default:
			endpointNames = append(endpointNames, record.Name)
		}
	}
	require.Equal(t, []string{"api2.example.com"}, hosts)
	require.Equal(t, []string{"https://api2.example.com"}, baseURLs)
	require.Equal(t, []string{"Primary"}, endpointNames)
	require.Equal(t, []string{"api2.example.com"}, common.DirectAPIHosts())
	require.Equal(t, "https://api2.example.com", common.DirectAPIBaseURL())
}

func TestMigrateDirectAPIConfigIsIdempotent(t *testing.T) {
	setupDirectAPIOptionTest(t)
	common.OptionMapRWMutex.Lock()
	common.OptionMap["DirectAPIHosts"] = "api.example.com"
	common.OptionMap["DirectAPIBaseURL"] = "https://api.example.com"
	common.OptionMap["DirectAPIHostsConfigured"] = "true"
	common.OptionMap["DirectAPIBaseURLConfigured"] = "true"
	common.OptionMapRWMutex.Unlock()

	require.NoError(t, MigrateDirectAPIConfig())
	require.NoError(t, MigrateDirectAPIConfig())

	records := common.DirectAPIEndpoints()
	hostCount, baseCount := 0, 0
	for _, record := range records {
		switch common.DirectAPIRecordKind(record) {
		case common.DirectAPIRecordKindHost:
			hostCount++
			require.Equal(t, "api.example.com", record.Endpoint)
		case common.DirectAPIRecordKindBaseURL:
			baseCount++
			require.Equal(t, "https://api.example.com", record.Endpoint)
		}
	}
	require.Equal(t, 1, hostCount)
	require.Equal(t, 1, baseCount)
	require.Equal(t, []string{"api.example.com"}, common.DirectAPIHosts())
	require.Equal(t, "https://api.example.com", common.DirectAPIBaseURL())
}
