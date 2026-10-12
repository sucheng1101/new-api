package common

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadOrCreateSessionSecretPersistsAcrossRestarts(t *testing.T) {
	secretPath := filepath.Join(t.TempDir(), "session.secret")
	t.Setenv("SESSION_SECRET_FILE", secretPath)

	first, err := loadOrCreateSessionSecret()
	require.NoError(t, err)
	require.NotEmpty(t, first)

	second, err := loadOrCreateSessionSecret()
	require.NoError(t, err)
	require.Equal(t, first, second)

	if runtime.GOOS != "windows" {
		permissions, err := os.Stat(secretPath)
		require.NoError(t, err)
		require.Equal(t, os.FileMode(0600), permissions.Mode().Perm())
	}
}

func TestLoadOrCreateSessionSecretRejectsEmptyFile(t *testing.T) {
	secretPath := filepath.Join(t.TempDir(), "session.secret")
	require.NoError(t, os.WriteFile(secretPath, []byte("\n"), 0600))
	t.Setenv("SESSION_SECRET_FILE", secretPath)

	_, err := loadOrCreateSessionSecret()
	require.Error(t, err)
	require.Contains(t, err.Error(), "empty")
}
