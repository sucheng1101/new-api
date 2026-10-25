package controller

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

var updateState = struct {
	sync.RWMutex
	running bool
	message string
	log     string
	mode    string
	script  string
}{message: "idle"}

type updatePlan struct {
	Mode    string `json:"mode"`
	Script  string `json:"script"`
	WorkDir string `json:"work_dir"`
	Ready   bool   `json:"ready"`
	Reason  string `json:"reason"`
}

func GetUpdateStatus(c *gin.Context) {
	plan := resolveUpdatePlan()
	updateState.RLock()
	defer updateState.RUnlock()
	mode := plan.Mode
	if updateState.mode != "" {
		mode = updateState.mode
	}
	script := plan.Script
	if updateState.script != "" {
		script = updateState.script
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"running": updateState.running,
		"message": updateState.message,
		"log":     updateState.log,
		"mode":    mode,
		"script":  script,
		"ready":   plan.Ready,
		"reason":  plan.Reason,
	}})
}

func updateMode() string {
	if mode := strings.ToLower(strings.TrimSpace(os.Getenv("NEW_API_UPDATE_MODE"))); mode != "" {
		switch mode {
		case "windows", "docker", "systemd":
			return mode
		default:
			return "unsupported"
		}
	}
	if os.Getenv("COMPOSE_PROJECT_NAME") != "" || os.Getenv("NEW_API_DOCKER") == "1" {
		return "docker"
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "docker"
	}
	if _, err := os.Stat("/run/.containerenv"); err == nil {
		return "docker"
	}
	if runtime.GOOS == "windows" {
		return "windows"
	}
	return "systemd"
}

func resolveUpdatePlan() updatePlan {
	mode := updateMode()
	plan := updatePlan{Mode: mode}
	if mode == "unsupported" {
		plan.Reason = "NEW_API_UPDATE_MODE must be windows, docker, or systemd"
		return plan
	}

	scriptName := map[string]string{
		"windows": "update-local.ps1",
		"docker":  "production-update-compose.sh",
		"systemd": "production-update.sh",
	}[mode]
	configured := strings.TrimSpace(os.Getenv("NEW_API_UPDATE_SCRIPT"))
	root := strings.TrimSpace(os.Getenv("NEW_API_UPDATE_ROOT"))
	if root == "" {
		if executable, err := os.Executable(); err == nil {
			root = filepath.Dir(executable)
		}
	}
	if root == "" {
		root, _ = os.Getwd()
	}
	root = filepath.Clean(root)

	candidates := make([]string, 0, 2)
	if configured != "" {
		candidates = append(candidates, filepath.Clean(configured))
	} else {
		candidates = append(candidates, filepath.Join(root, "scripts", scriptName))
		if cwd, err := os.Getwd(); err == nil && filepath.Clean(cwd) != root {
			candidates = append(candidates, filepath.Join(cwd, "scripts", scriptName))
		}
	}
	plan.Script = candidates[0]
	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() {
			plan.Script = candidate
			plan.WorkDir = filepath.Dir(filepath.Dir(candidate))
			plan.Ready = true
			return plan
		}
	}
	if mode == "docker" {
		plan.Reason = fmt.Sprintf("Docker 在线升级需要宿主机升级脚本，请设置 NEW_API_UPDATE_SCRIPT；当前路径不存在：%s", plan.Script)
	} else {
		plan.Reason = fmt.Sprintf("升级脚本不存在：%s，请设置 NEW_API_UPDATE_SCRIPT", plan.Script)
	}
	return plan
}

func StartUpdate(c *gin.Context) {
	var req struct {
		Tag string `json:"tag" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !strings.HasPrefix(req.Tag, "v") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid release tag"})
		return
	}
	plan := resolveUpdatePlan()
	if !plan.Ready {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": plan.Reason, "data": plan})
		return
	}
	updateState.Lock()
	if updateState.running {
		updateState.Unlock()
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "update already running"})
		return
	}
	updateState.running, updateState.message, updateState.log = true, "starting", ""
	updateState.mode, updateState.script = plan.Mode, plan.Script
	updateState.Unlock()

	go runUpdate(req.Tag, plan)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "update started"})
}

func runUpdate(tag string, plan updatePlan) {
	var cmd *exec.Cmd
	switch plan.Mode {
	case "windows":
		cmd = exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-File", plan.Script, "-Tag", tag, "-StopProcess")
	case "docker":
		cmd = exec.Command("bash", plan.Script)
		cmd.Env = append(os.Environ(), "RELEASE_TAG="+tag, "CONFIRM_RELEASE=YES")
	default:
		cmd = exec.Command("bash", plan.Script)
		cmd.Env = append(os.Environ(), "RELEASE_TAG="+tag, "CONFIRM_RELEASE=YES")
	}
	cmd.Dir = plan.WorkDir
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
