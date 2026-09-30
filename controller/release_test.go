package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestFetchLatestRelease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "new-api-update-checker", r.Header.Get("User-Agent"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v1.2.3","name":"Promotion release","body":"notes","html_url":"https://example.invalid/release","assets":[{"name":"new-api.exe","browser_download_url":"https://example.invalid/new-api.exe","size":42}]}`))
	}))
	defer server.Close()

	release, err := fetchLatestRelease(context.Background(), &http.Client{Timeout: time.Second}, server.URL)
	require.NoError(t, err)
	require.Equal(t, "v1.2.3", release.TagName)
	require.Len(t, release.Assets, 1)
	require.Equal(t, int64(42), release.Assets[0].Size)
}

func TestFetchLatestReleaseRejectsNonSuccess(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()

	_, err := fetchLatestRelease(context.Background(), http.DefaultClient, server.URL)
	require.Error(t, err)
}
