package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuiltinSunoPluginRouteAdmission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	outer := gin.New()
	SetRelayRouter(outer)

	source, err := builtinplugins.Source("sunoapi")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: "sunoapi"})
	require.NoError(t, err)

	builder := newPluginGenerationBuilder(
		outer.Routes(),
		nil,
		func(_ *jsplugin.RoutingGeneration, _ jsplugin.RouteBinding) []gin.HandlerFunc {
			return []gin.HandlerFunc{func(c *gin.Context) { c.Status(http.StatusNoContent) }}
		},
	)
	require.NoError(t, registry.SetGenerationPreparer(builder.prepare))
	require.Empty(t, registry.RoutingErrors())

	binding, found := registry.Generation().LookupDeclaredRoute(http.MethodPost, "/suno/submit/:action")
	require.True(t, found)
	assert.Same(t, plugin, binding.Plugin)
	assert.Equal(t, "sunoapi", binding.Plugin.Meta.Key)

	outer.NoRoute(
		(&pluginRouteDispatcher{registry: registry}).dispatch,
		func(c *gin.Context) { c.String(http.StatusOK, "fallback") },
	)
	recorder := httptest.NewRecorder()
	outer.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/not-owned-by-a-plugin", nil))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "fallback", recorder.Body.String())
}
