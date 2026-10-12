package model

import (
	"errors"
	"fmt"
	"net"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	DirectIPAllowlistMaxEntries = 5
	DirectIPAllowlistRetention  = int64(180 * 24 * 60 * 60)
)

type DirectIPAllowlist struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"not null;index;uniqueIndex:idx_direct_ip_allowlist_user_ip,priority:1"`
	IP           string `json:"ip" gorm:"column:ip;type:varchar(45);not null;uniqueIndex:idx_direct_ip_allowlist_user_ip,priority:2"`
	Remark       string `json:"remark" gorm:"type:varchar(255);default:''"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;not null;index"`
	LastAccessAt int64  `json:"last_access_at" gorm:"bigint;default:0;index"`
}

func NormalizeDirectIPv4(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", errors.New("IPv4 地址不能为空")
	}
	ip := net.ParseIP(value)
	if ip == nil || ip.To4() == nil || strings.Contains(value, "/") {
		return "", errors.New("仅支持精确 IPv4 地址")
	}
	return ip.To4().String(), nil
}

func GetDirectIPAllowlists(userId int) ([]DirectIPAllowlist, error) {
	if userId <= 0 {
		return nil, errors.New("用户 ID 无效")
	}
	var entries []DirectIPAllowlist
	err := DB.Where("user_id = ?", userId).Order("id asc").Find(&entries).Error
	return entries, err
}

func CreateDirectIPAllowlist(userId int, rawIP, remark string) (*DirectIPAllowlist, error) {
	if userId <= 0 {
		return nil, errors.New("用户 ID 无效")
	}
	ip, err := NormalizeDirectIPv4(rawIP)
	if err != nil {
		return nil, err
	}
	remark = strings.TrimSpace(remark)
	if len([]rune(remark)) > 255 {
		return nil, errors.New("备注不能超过 255 个字符")
	}

	var entry DirectIPAllowlist
	err = DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&DirectIPAllowlist{}).Where("user_id = ?", userId).Count(&count).Error; err != nil {
			return err
		}
		if count >= DirectIPAllowlistMaxEntries {
			return errors.New("每个账号最多添加 5 个 IPv4 地址")
		}
		if err := tx.Where("user_id = ? AND ip = ?", userId, ip).First(&entry).Error; err == nil {
			return errors.New("该 IPv4 地址已经添加")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := common.GetTimestamp()
		entry = DirectIPAllowlist{UserId: userId, IP: ip, Remark: remark, CreatedAt: now}
		return tx.Create(&entry).Error
	})
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

func DeleteDirectIPAllowlist(userId, id int) error {
	if userId <= 0 || id <= 0 {
		return errors.New("参数无效")
	}
	result := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&DirectIPAllowlist{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// CheckAndTouchDirectIPAllowlist authorizes a direct-host request and updates
// the matched entry's last-access timestamp. Empty lists are denied so that a
// configured direct host never becomes an unprotected source-IP bypass.
func CheckAndTouchDirectIPAllowlist(userId int, rawIP string) (bool, error) {
	ip, err := NormalizeDirectIPv4(rawIP)
	if err != nil {
		return false, nil
	}
	if userId <= 0 {
		return false, errors.New("用户 ID 无效")
	}
	cutoff := common.GetTimestamp() - DirectIPAllowlistRetention
	// Expiry is applied lazily as well as by the daily cleanup task, so a stale
	// entry cannot remain usable between scheduled cleanup runs.
	if err := DB.Where("user_id = ? AND ((last_access_at > 0 AND last_access_at < ?) OR (last_access_at = 0 AND created_at < ?))", userId, cutoff, cutoff).Delete(&DirectIPAllowlist{}).Error; err != nil {
		return false, err
	}
	var entry DirectIPAllowlist
	err = DB.Where("user_id = ? AND ip = ?", userId, ip).First(&entry).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	now := common.GetTimestamp()
	if err := DB.Model(&entry).Updates(map[string]any{"last_access_at": now}).Error; err != nil {
		return false, err
	}
	return true, nil
}

func CleanupStaleDirectIPAllowlists() (int64, error) {
	cutoff := common.GetTimestamp() - DirectIPAllowlistRetention
	result := DB.Where("(last_access_at > 0 AND last_access_at < ?) OR (last_access_at = 0 AND created_at < ?)", cutoff, cutoff).Delete(&DirectIPAllowlist{})
	return result.RowsAffected, result.Error
}

func DirectIPAllowlistErrorMessage(err error) string {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "未找到该 IPv4 白名单记录"
	}
	if err == nil {
		return ""
	}
	return fmt.Sprint(err)
}
