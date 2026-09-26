package model

import (
	"github.com/QuantumNous/new-api/common"
)

// migrateUserSidebarPromotionModule backfills the promotion entry into the
// personal section of existing users' sidebar config. Sidebar config is
// written as a snapshot at registration time, so modules added later never
// reach accounts created before them. This migration is idempotent: it only
// adds the missing key and leaves explicit user preferences untouched.
func migrateUserSidebarPromotionModule() error {
	if DB == nil {
		return nil
	}
	var users []User
	if err := DB.Where("setting IS NOT NULL AND setting <> ''").Find(&users).Error; err != nil {
		return err
	}
	for _, user := range users {
		setting := user.GetSetting()
		if setting.SidebarModules == "" {
			continue
		}
		var sidebarModules map[string]interface{}
		if err := common.UnmarshalJsonStr(setting.SidebarModules, &sidebarModules); err != nil {
			// A malformed snapshot is not worth failing startup over; leave it alone.
			continue
		}
		personal, ok := sidebarModules["personal"].(map[string]interface{})
		if !ok {
			continue
		}
		if _, exists := personal["promotion"]; exists {
			continue
		}
		personal["promotion"] = true
		sidebarModules["personal"] = personal
		encoded, err := common.Marshal(sidebarModules)
		if err != nil {
			return err
		}
		setting.SidebarModules = string(encoded)
		user.SetSetting(setting)
		if err := DB.Model(&User{}).Where("id = ?", user.Id).Update("setting", user.Setting).Error; err != nil {
			return err
		}
	}
	return nil
}
