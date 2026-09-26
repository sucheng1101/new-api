package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

// SetTaskRouter registers the generic task-plugin API surface. The shared
// :key wildcard is intentional: Gin requires routes at the same path
// position to use the same parameter name.
func SetTaskRouter(router *gin.Engine) {
	taskSubmitRouter := router.Group("/v1/tasks")
	taskSubmitRouter.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		taskSubmitRouter.POST("/:key", middleware.PrepareTaskPluginSubmit(), middleware.Distribute(), controller.RelayTask)
	}

	taskReadRouter := router.Group("/v1/tasks")
	taskReadRouter.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		taskReadRouter.GET("/:key", controller.GetTask)
		taskReadRouter.GET("/:key/artifacts", controller.GetTaskArtifacts)
	}

	taskContentRouter := router.Group("/v1/tasks")
	taskContentRouter.Use(
		middleware.RouteTag("relay"),
		middleware.TokenOrTaskArtifactAccessAuth("key", "artifact_key"),
	)
	{
		taskContentRouter.GET("/:key/artifacts/:artifact_key/content", controller.TaskArtifactContent)
		taskContentRouter.HEAD("/:key/artifacts/:artifact_key/content", controller.TaskArtifactContent)
	}
}
