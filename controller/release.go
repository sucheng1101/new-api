package controller

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

const releaseRequestTimeout = 8 * time.Second

type releaseSource struct {
	Name string
	URL  string
}

var projectReleaseSources = []releaseSource{
	{Name: "github", URL: "https://api.github.com/repos/sucheng1101/new-api/releases/latest"},
	{Name: "gitee", URL: "https://gitee.com/api/v5/repos/sucheng1101/new-api/releases/latest"},
}

type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	DownloadURL        string `json:"download_url"`
	Size               int64  `json:"size"`
}

type latestRelease struct {
	TagName     string         `json:"tag_name"`
	Name        string         `json:"name"`
	Body        string         `json:"body"`
	HTMLURL     string         `json:"html_url"`
	PublishedAt string         `json:"published_at"`
	Draft       bool           `json:"draft"`
	Prerelease  bool           `json:"prerelease"`
	Assets      []releaseAsset `json:"assets"`
}

// GetLatestRelease returns the newest project-owned release. The UI calls this
// endpoint instead of reaching a forge directly so source fallback stays
// consistent between local and production instances.
func GetLatestRelease(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), releaseRequestTimeout)
	defer cancel()

	client := &http.Client{Timeout: releaseRequestTimeout}
	for _, source := range projectReleaseSources {
		release, err := fetchLatestRelease(ctx, client, source.URL)
		if err != nil || release.TagName == "" || release.Draft {
			continue
		}

		common.ApiSuccess(c, gin.H{
			"source":  source.Name,
			"release": release,
		})
		return
	}

	common.ApiErrorMsg(c, "No project release is available yet.")
}

func fetchLatestRelease(ctx context.Context, client *http.Client, endpoint string) (latestRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return latestRelease{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "new-api-update-checker")

	resp, err := client.Do(req)
	if err != nil {
		return latestRelease{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return latestRelease{}, fmt.Errorf("release source returned HTTP %d", resp.StatusCode)
	}

	var release latestRelease
	if err := common.DecodeJson(resp.Body, &release); err != nil {
		return latestRelease{}, err
	}
	return release, nil
}
