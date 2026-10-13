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
