package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

func registerAuthzRoutes(apiRouter *gin.RouterGroup) {
	authzRoute := apiRouter.Group("/authz")
	authzRoute.Use(middleware.AdminAuth())
	authzRoute.GET("/catalog", controller.GetPermissionCatalog)
}
