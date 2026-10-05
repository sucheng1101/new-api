package controller

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

var updateState = struct {
	sync.RWMutex
	running bool
	message string
	log     string
}{message: "idle"}

func GetUpdateStatus(c *gin.Context) {
	updateState.RLock()
	defer updateState.RUnlock()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"running": updateState.running, "message": updateState.message, "log": updateState.log}})
}

func StartUpdate(c *gin.Context) {
	var req struct {
		Tag string `json:"tag" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !strings.HasPrefix(req.Tag, "v") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid release tag"})
		return
	}
	updateState.Lock()
	if updateState.running {
		updateState.Unlock()
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "update already running"})
		return
	}
	updateState.running, updateState.message, updateState.log = true, "starting", ""
	updateState.Unlock()

	go runUpdate(req.Tag)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "update started"})
}

func runUpdate(tag string) {
	root, _ := os.Getwd()
	script := filepath.Join(root, "scripts", "production-update.sh")
	cmd := exec.Command("bash", script)
	cmd.Env = append(os.Environ(), "RELEASE_TAG="+tag, "CONFIRM_RELEASE=YES")
	out, err := cmd.CombinedOutput()
	updateState.Lock()
	defer updateState.Unlock()
	updateState.running = false
	updateState.log = string(out)
	if err != nil {
		updateState.message = "failed"
		return
	}
	updateState.message = "completed"
}
