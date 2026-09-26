package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
)

// GetPermissionCatalog exposes the permission catalog used by admin clients.
func GetPermissionCatalog(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"resources": authz.Catalog(),
			"roles":     authz.Roles(),
		},
	})
}
