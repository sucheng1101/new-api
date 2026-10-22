package common

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeDirectAPIHostConfig(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "normalizes and de-duplicates hosts", input: " HTTPS://API.Example.com/, api.example.com:443 ", want: "api.example.com"},
		{name: "accepts a port", input: "api.example.com:8443", want: "api.example.com"},
		{name: "rejects path", input: "https://api.example.com/v1", wantErr: true},
		{name: "rejects ip address", input: "192.0.2.10", wantErr: true},
		{name: "rejects invalid port", input: "api.example.com:70000", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeDirectAPIHostConfig(test.input)
			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.want, got)
		})
	}
}

func TestValidateDirectAPIBaseURL(t *testing.T) {
	require.NoError(t, ValidateDirectAPIBaseURL("https://api.example.com/v1"))
	require.NoError(t, ValidateDirectAPIBaseURL("http://127.0.0.1:5200"))
	require.Error(t, ValidateDirectAPIBaseURL("api.example.com"))
	require.Error(t, ValidateDirectAPIBaseURL("https://user:pass@api.example.com"))
	require.Error(t, ValidateDirectAPIBaseURL("https://api.example.com?token=secret"))
	require.Error(t, ValidateDirectAPIBaseURL("https://api.example.com:70000"))
}

func TestDirectAPITokenUseCurrentOrigin(t *testing.T) {
	previous := OptionMap
	OptionMapRWMutex.Lock()
	OptionMap = map[string]string{DirectAPITokenUseCurrentOriginKey: "true"}
	OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		OptionMapRWMutex.Lock()
		OptionMap = previous
		OptionMapRWMutex.Unlock()
	})
	require.True(t, DirectAPITokenUseCurrentOrigin())
	OptionMapRWMutex.Lock()
	OptionMap[DirectAPITokenUseCurrentOriginKey] = "false"
	OptionMapRWMutex.Unlock()
	require.False(t, DirectAPITokenUseCurrentOrigin())
}

func TestValidateDirectAPIEndpoints(t *testing.T) {
	items, err := ValidateDirectAPIEndpoints([]DirectAPIEndpoint{{
		Name:      "OpenAI mirror",
		Endpoint:  "https://api.example.com/v1/",
		Enabled:   true,
		SortOrder: 0,
	}})
	require.NoError(t, err)
	require.Equal(t, 1, items[0].ID)
	require.Equal(t, "https://api.example.com/v1", items[0].Endpoint)

	_, err = ValidateDirectAPIEndpoints([]DirectAPIEndpoint{{Name: "bad", Endpoint: "https://api.example.com/v1?token=secret"}})
	require.Error(t, err)
	_, err = ValidateDirectAPIEndpoints([]DirectAPIEndpoint{{Name: "bad", Endpoint: ""}})
	require.Error(t, err)
	_, err = ValidateDirectAPIEndpoints([]DirectAPIEndpoint{{ID: 1, Name: "a", Endpoint: "https://api.example.com/v1"}, {ID: 1, Name: "b", Endpoint: "https://api.example.com/v2"}})
	require.Error(t, err)
	_, err = ValidateDirectAPIEndpoints([]DirectAPIEndpoint{{Name: "a", Endpoint: "https://api.example.com/v1", SortOrder: -1}})
	require.Error(t, err)
}

func TestDirectAPILegacyFallbackBeforeMigration(t *testing.T) {
	OptionMapRWMutex.Lock()
	previous := OptionMap
	OptionMap = map[string]string{
		"DirectAPIHosts":             "Api.Example.com",
		"DirectAPIBaseURL":           "https://api.example.com/",
		"DirectAPIHostsConfigured":   "true",
		"DirectAPIBaseURLConfigured": "true",
	}
	OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		OptionMapRWMutex.Lock()
		OptionMap = previous
		OptionMapRWMutex.Unlock()
	})

	require.Equal(t, []string{"api.example.com"}, DirectAPIHosts())
	require.Equal(t, "https://api.example.com", DirectAPIBaseURL())
}

func TestValidateDirectAPIRecordKinds(t *testing.T) {
	items, err := ValidateDirectAPIEndpoints([]DirectAPIEndpoint{
		{Kind: DirectAPIRecordKindHost, Endpoint: " HTTPS://API.Example.com/ "},
		{Kind: DirectAPIRecordKindBaseURL, Endpoint: "https://api.example.com/"},
		{Kind: DirectAPIRecordKindEndpoint, Name: "mirror", Endpoint: "https://api.example.com/v1/"},
	})
	require.NoError(t, err)
	require.Equal(t, DirectAPIRecordKindHost, items[0].Kind)
	require.Equal(t, "api.example.com", items[0].Endpoint)
	require.Equal(t, "api.example.com", items[0].Name)
	require.Equal(t, DirectAPIRecordKindBaseURL, items[1].Kind)
	require.Equal(t, "https://api.example.com", items[1].Endpoint)
	require.Equal(t, DirectAPIRecordKindEndpoint, items[2].Kind)
	require.NotZero(t, items[0].UpdatedAt)

	_, err = ValidateDirectAPIEndpoints([]DirectAPIEndpoint{{Kind: DirectAPIRecordKindHost, Endpoint: "api.example.com,api2.example.com"}})
	require.Error(t, err)
	_, err = ValidateDirectAPIEndpoints([]DirectAPIEndpoint{{Kind: DirectAPIRecordKindBaseURL, Endpoint: "https://api.example.com"}, {Kind: DirectAPIRecordKindBaseURL, Endpoint: "https://api2.example.com"}})
	require.Error(t, err)
	_, err = ValidateDirectAPIEndpoints([]DirectAPIEndpoint{{Kind: "bogus", Endpoint: "https://api.example.com"}})
	require.Error(t, err)
}

func TestDirectAPIRecordsDriveHostsAndBaseURL(t *testing.T) {
	OptionMapRWMutex.Lock()
	previous := OptionMap
	OptionMap = map[string]string{}
	encoded, err := Marshal([]DirectAPIEndpoint{
		{ID: 1, Kind: DirectAPIRecordKindHost, Endpoint: "api.example.com", Enabled: true},
		{ID: 2, Kind: DirectAPIRecordKindHost, Endpoint: "disabled.example.com", Enabled: false},
		{ID: 3, Kind: DirectAPIRecordKindBaseURL, Endpoint: "https://api.example.com", Enabled: true},
		{ID: 4, Kind: DirectAPIRecordKindEndpoint, Name: "mirror", Endpoint: "https://api.example.com/v1", Enabled: true, SortOrder: 5},
	})
	require.NoError(t, err)
	OptionMap["DirectAPIEndpoints"] = string(encoded)
	OptionMap[DirectAPIRecordsMigratedOption] = "true"
	OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		OptionMapRWMutex.Lock()
		OptionMap = previous
		OptionMapRWMutex.Unlock()
	})

	require.Equal(t, []string{"api.example.com"}, DirectAPIHosts())
	require.Equal(t, "https://api.example.com", DirectAPIBaseURL())
	require.True(t, IsDirectAPIRequest("api.example.com"))
	require.False(t, IsDirectAPIRequest("disabled.example.com"))
	require.Len(t, EnabledDirectAPIEndpoints(), 1)
	require.Equal(t, DirectAPIRecordKindEndpoint, enabledRecordKind(t))
}

func enabledRecordKind(t *testing.T) string {
	t.Helper()
	records := EnabledDirectAPIEndpoints()
	if len(records) != 1 {
		t.Fatalf("expected exactly one enabled endpoint record, got %d", len(records))
	}
	return DirectAPIRecordKind(records[0])
}

func TestEnabledDirectAPIEndpointsSortsAndFilters(t *testing.T) {
	OptionMapRWMutex.Lock()
	previous := OptionMap
	OptionMap = map[string]string{}
	encoded, err := Marshal([]DirectAPIEndpoint{
		{ID: 2, Name: "second", Endpoint: "https://api.example.com/second", Enabled: true, SortOrder: 2},
		{ID: 1, Name: "disabled", Endpoint: "https://api.example.com/disabled", Enabled: false, SortOrder: 0},
		{ID: 3, Name: "first", Endpoint: "https://api.example.com/first", Enabled: true, SortOrder: 1},
	})
	require.NoError(t, err)
	OptionMap["DirectAPIEndpoints"] = string(encoded)
	OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		OptionMapRWMutex.Lock()
		OptionMap = previous
		OptionMapRWMutex.Unlock()
	})

	items := EnabledDirectAPIEndpoints()
	require.Len(t, items, 2)
	require.Equal(t, "first", items[0].Name)
	require.Equal(t, "second", items[1].Name)
}
