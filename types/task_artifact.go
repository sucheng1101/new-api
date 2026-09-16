package types

import "net/http"

// TaskArtifact is the transport-neutral identity of one generated task output.
// relay/channel re-exports this type for adaptor compatibility.
type TaskArtifact struct {
	Key      string `json:"key"`
	Type     string `json:"type"`
	MimeType string `json:"mimeType,omitempty"`
}

// TaskArtifactClientRequest carries the media cache validators the client sent
// to the public artifact endpoint. Plugins may use them when constructing an
// upstream content request.
type TaskArtifactClientRequest struct {
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers,omitempty"`
}

// TaskContentRequest is the credential-aware upstream request produced by a
// task plugin for one artifact. It is transport-neutral so polling and media
// serving can use the same contract without importing relay/channel.
type TaskContentRequest struct {
	URL                       string
	Method                    string
	Headers                   map[string]string
	Body                      []byte
	Credentialless            bool
	DropCredentialsOnRedirect bool
}

// TaskArtifactResponseHeaders is the bounded set of cache and media headers
// that can be relayed from a persisted object response.
func TaskArtifactResponseHeaders(destination, source http.Header) {
	for _, name := range []string{
		"Content-Type",
		"Content-Length",
		"Content-Range",
		"Accept-Ranges",
		"ETag",
		"Last-Modified",
		"Content-Disposition",
	} {
		for _, value := range source.Values(name) {
			destination.Add(name, value)
		}
	}
}
