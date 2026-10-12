package common

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDirectAPIHostsAndBaseURL(t *testing.T) {
	t.Setenv("DIRECT_API_HOST", "https://GW.Example.com., gw.example.com:443")
	t.Setenv("DIRECT_API_BASE_URL", "")
	assert.Equal(t, []string{"gw.example.com"}, DirectAPIHosts())
	assert.True(t, IsDirectAPIRequest("gw.example.com:443"))
	assert.True(t, IsDirectAPIRequest("GW.EXAMPLE.COM."))
	assert.False(t, IsDirectAPIRequest("api.example.com"))
	assert.Equal(t, "https://gw.example.com", DirectAPIBaseURL())

	t.Setenv("DIRECT_API_BASE_URL", "https://direct.example.com/")
	assert.Equal(t, "https://direct.example.com", DirectAPIBaseURL())
}

func TestDirectAPIHostConfigurationCanBeDisabled(t *testing.T) {
	previous, hadValue := os.LookupEnv("DIRECT_API_HOST")
	t.Cleanup(func() {
		if hadValue {
			_ = os.Setenv("DIRECT_API_HOST", previous)
		} else {
			_ = os.Unsetenv("DIRECT_API_HOST")
		}
	})
	_ = os.Unsetenv("DIRECT_API_HOST")
	assert.Empty(t, DirectAPIHosts())
	assert.False(t, IsDirectAPIRequest("gw.example.com"))
}
