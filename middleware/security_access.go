package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

type securityIPCacheEntry struct {
	blocked bool
	expires time.Time
}

var securityIPCache = struct {
	sync.RWMutex
	items map[string]securityIPCacheEntry
}{items: make(map[string]securityIPCacheEntry)}

func invalidateSecurityIPCache(address string) {
	securityIPCache.Lock()
	delete(securityIPCache.items, address)
	securityIPCache.Unlock()
}

func isSecurityIPBlocked(address string) bool {
	securityIPCache.RLock()
	entry, ok := securityIPCache.items[address]
	securityIPCache.RUnlock()
	if ok && time.Now().Before(entry.expires) {
		return entry.blocked
	}
	blocked, err := model.IsSecurityIPBlocked(address)
	if err != nil {
		common.SysLog("security IP block lookup failed: " + err.Error())
		return false
	}
	securityIPCache.Lock()
	securityIPCache.items[address] = securityIPCacheEntry{blocked: blocked, expires: time.Now().Add(10 * time.Second)}
	securityIPCache.Unlock()
	return blocked
}

// IPBlockGuard applies administrator-created exact-IP deny rules to the whole
// HTTP surface, including the embedded frontend and API routes.
func IPBlockGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if isSecurityIPBlocked(c.ClientIP()) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": "当前 IP 已被安全策略拦截",
			})
			return
		}
		c.Next()
	}
}

func auditActor(c *gin.Context) (int, string, int) {
	id := c.GetInt("id")
	username := c.GetString("username")
	role := c.GetInt("role")
	if id == 0 {
		session := sessions.Default(c)
		if value := session.Get("id"); value != nil {
			id, _ = value.(int)
		}
		if username == "" {
			username, _ = session.Get("username").(string)
		}
		if role == 0 {
			role, _ = session.Get("role").(int)
		}
	}
	return id, username, role
}

func auditAction(path, method string) (string, bool) {
	path = strings.ToLower(path)
	method = strings.ToUpper(method)
	if strings.HasSuffix(path, "/login") || strings.Contains(path, "/login/") {
		return "login", true
	}
	if strings.HasSuffix(path, "/register") {
		return "register", true
	}
	if strings.HasSuffix(path, "/logout") {
		return "logout", true
	}
	if strings.Contains(path, "/topup") || strings.Contains(path, "/pay") || strings.Contains(path, "/wallet") {
		return "wallet." + strings.ToLower(method), true
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		return strings.ToLower(method) + "." + strings.Trim(strings.ReplaceAll(path, "/", "."), "."), true
	}
	return "", false
}

// AuditRecorder records state-changing API requests without persisting request
// bodies or credentials.
func AuditRecorder() gin.HandlerFunc {
	return func(c *gin.Context) {
		action, shouldRecord := auditAction(c.Request.URL.Path, c.Request.Method)
		beforeID, beforeUsername, beforeRole := auditActor(c)
		c.Next()
		if !shouldRecord {
			return
		}
		id, username, role := auditActor(c)
		if id == 0 {
			id = beforeID
		}
		if username == "" {
			username = beforeUsername
		}
		if role == 0 {
			role = beforeRole
		}
		success := c.Writer.Status() >= 200 && c.Writer.Status() < 400
		if action == "login" && !success {
			action = "login.failed"
		}
		category := model.AuditCategoryOperation
		if strings.HasPrefix(action, "login") || action == "register" || action == "logout" {
			category = model.AuditCategoryLogin
		}
		model.RecordAuditLog(c, model.AuditLog{
			UserId: id, Username: username, ActorRole: role,
			Category: category, Action: action,
			Status: c.Writer.Status(), Success: success,
		})
	}
}
