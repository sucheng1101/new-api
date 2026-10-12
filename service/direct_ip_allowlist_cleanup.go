package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const directIPAllowlistCleanupInterval = 24 * time.Hour

func StartDirectIPAllowlistCleanupTask() {
	go func() {
		cleanup := func() {
			removed, err := model.CleanupStaleDirectIPAllowlists()
			if err != nil {
				common.SysLog("direct IP allowlist cleanup failed: " + err.Error())
				return
			}
			if removed > 0 {
				common.SysLog("direct IP allowlist cleanup removed " + fmt.Sprint(removed) + " stale entries")
			}
		}
		cleanup()
		ticker := time.NewTicker(directIPAllowlistCleanupInterval)
		defer ticker.Stop()
		for range ticker.C {
			cleanup()
		}
	}()
}
