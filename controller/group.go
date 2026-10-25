package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func GetGroups(c *gin.Context) {
	groupNames := make([]string, 0)
	for groupName := range ratio_setting.GetGroupRatioCopy() {
		groupNames = append(groupNames, groupName)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]interface{})
	userGroup := ""
	userId := c.GetInt("id")
	userGroup, _ = model.GetUserGroup(userId, false)
	userUsableGroups := service.GetUserUsableGroups(userGroup)
	for groupName, _ := range ratio_setting.GetGroupRatioCopy() {
		// UserUsableGroups contains the groups that the user can use
		if desc, ok := userUsableGroups[groupName]; ok {
			usableGroups[groupName] = map[string]interface{}{
				"ratio":  service.GetUserGroupRatio(userGroup, groupName),
				"desc":   desc,
				"models": model.GetGroupEnabledModels(groupName),
			}
		}
	}
	if _, ok := userUsableGroups["auto"]; ok {
		// Auto groups expose the union of enabled models from all groups that
		// participate in the user's automatic routing configuration.
		models := make([]string, 0)
		seenModels := make(map[string]struct{})
		for _, autoGroup := range service.GetUserAutoGroup(userGroup) {
			for _, groupModel := range model.GetGroupEnabledModels(autoGroup) {
				if _, seen := seenModels[groupModel]; seen {
					continue
				}
				seenModels[groupModel] = struct{}{}
				models = append(models, groupModel)
			}
		}
		usableGroups["auto"] = map[string]interface{}{
			"ratio":  "自动",
			"desc":   setting.GetUsableGroupDescription("auto"),
			"models": models,
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}
