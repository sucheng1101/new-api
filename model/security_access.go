package model

import (
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// SecurityIPBlock is an administrator-managed exact IP deny rule. Exact IPs
// are intentionally used here so a mistaken CIDR cannot lock out a whole
// network from the console.
type SecurityIPBlock struct {
	Id        int    `json:"id"`
	Address   string `json:"address" gorm:"size:64;uniqueIndex"`
	Reason    string `json:"reason" gorm:"size:255"`
	Enabled   bool   `json:"enabled" gorm:"index"`
	CreatedBy int    `json:"created_by" gorm:"index"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime;index"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func NormalizeSecurityIP(value string) (string, error) {
	value = strings.TrimSpace(value)
	parsed := net.ParseIP(value)
	if parsed == nil {
		return "", fmt.Errorf("invalid IP address: %s", value)
	}
	return parsed.String(), nil
}

func IsSecurityIPBlocked(value string) (bool, error) {
	if DB == nil {
		return false, nil
	}
	ip, err := NormalizeSecurityIP(value)
	if err != nil {
		return false, nil
	}
	var count int64
	err = DB.Model(&SecurityIPBlock{}).
		Where("address = ? AND enabled = ?", ip, commonTrueVal).
		Count(&count).Error
	return count > 0, err
}

func ListSecurityIPBlocks(offset, limit int) ([]*SecurityIPBlock, int64, error) {
	query := DB.Model(&SecurityIPBlock{}).Order("enabled DESC").Order("created_at DESC")
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]*SecurityIPBlock, 0)
	if err := query.Offset(offset).Limit(limit).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func CountActiveSecurityIPBlocks() (int64, error) {
	if DB == nil {
		return 0, nil
	}
	var count int64
	err := DB.Model(&SecurityIPBlock{}).Where("enabled = ?", commonTrueVal).Count(&count).Error
	return count, err
}

func CreateSecurityIPBlock(address, reason string, createdBy int) (*SecurityIPBlock, error) {
	ip, err := NormalizeSecurityIP(address)
	if err != nil {
		return nil, err
	}
	item := &SecurityIPBlock{
		Address:   ip,
		Reason:    strings.TrimSpace(reason),
		Enabled:   true,
		CreatedBy: createdBy,
		CreatedAt: common.GetTimestamp(),
		UpdatedAt: common.GetTimestamp(),
	}
	if err := DB.Create(item).Error; err != nil {
		return nil, err
	}
	return item, nil
}

func DeleteSecurityIPBlock(id int) error {
	if id <= 0 {
		return errors.New("invalid IP block id")
	}
	return DB.Delete(&SecurityIPBlock{}, id).Error
}

func SetSecurityIPBlockEnabled(id int, enabled bool) error {
	if id <= 0 {
		return errors.New("invalid IP block id")
	}
	return DB.Model(&SecurityIPBlock{}).Where("id = ?", id).Updates(map[string]any{
		"enabled":    enabled,
		"updated_at": common.GetTimestamp(),
	}).Error
}

type SecurityIPRisk struct {
	Address    string `json:"address"`
	UserCount  int64  `json:"user_count"`
	EventCount int64  `json:"event_count"`
	LastSeen   int64  `json:"last_seen"`
}

func GetSecurityIPRisks(startTimestamp, endTimestamp int64, limit int) ([]SecurityIPRisk, error) {
	if DB == nil && LOG_DB == nil {
		return []SecurityIPRisk{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	type userIPRow struct {
		Address   string
		UserCount int64
		LastSeen  int64
	}
	type auditIPRow struct {
		Address    string
		UserCount  int64
		EventCount int64
		LastSeen   int64
	}
	type riskAggregate struct {
		SecurityIPRisk
	}
	aggregates := make(map[string]*riskAggregate)

	if DB != nil {
		users := make([]userIPRow, 0)
		query := DB.Model(&User{}).
			Select("register_ip AS address, COUNT(*) AS user_count, MAX(created_at) AS last_seen").
			Where("register_ip IS NOT NULL AND register_ip <> ''").
			Group("register_ip").
			Having("COUNT(*) >= ?", 2)
		if startTimestamp > 0 {
			query = query.Where("created_at >= ?", startTimestamp)
		}
		if endTimestamp > 0 {
			query = query.Where("created_at <= ?", endTimestamp)
		}
		if err := query.Scan(&users).Error; err != nil {
			return nil, err
		}
		for _, row := range users {
			address := strings.TrimSpace(row.Address)
			if address == "" {
				continue
			}
			aggregates[address] = &riskAggregate{
				SecurityIPRisk: SecurityIPRisk{
					Address:   address,
					UserCount: row.UserCount,
					LastSeen:  row.LastSeen,
				},
			}
		}
	}

	if LOG_DB != nil {
		audits := make([]auditIPRow, 0)
		query := LOG_DB.Model(&AuditLog{}).
			Select("ip AS address, COUNT(DISTINCT user_id) AS user_count, COUNT(*) AS event_count, MAX(created_at) AS last_seen").
			Where("ip IS NOT NULL AND ip <> ''")
		if startTimestamp > 0 {
			query = query.Where("created_at >= ?", startTimestamp)
		}
		if endTimestamp > 0 {
			query = query.Where("created_at <= ?", endTimestamp)
		}
		if err := query.Group("ip").Scan(&audits).Error; err != nil {
			return nil, err
		}
		for _, row := range audits {
			address := strings.TrimSpace(row.Address)
			if address == "" {
				continue
			}
			aggregate, ok := aggregates[address]
			if !ok {
				aggregate = &riskAggregate{SecurityIPRisk: SecurityIPRisk{Address: address}}
				aggregates[address] = aggregate
			}
			if row.UserCount > aggregate.UserCount {
				aggregate.UserCount = row.UserCount
			}
			if row.EventCount > aggregate.EventCount {
				aggregate.EventCount = row.EventCount
			}
			if row.LastSeen > aggregate.LastSeen {
				aggregate.LastSeen = row.LastSeen
			}
		}
	}

	rows := make([]SecurityIPRisk, 0, len(aggregates))
	for _, aggregate := range aggregates {
		if aggregate.UserCount < 2 {
			continue
		}
		rows = append(rows, aggregate.SecurityIPRisk)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].UserCount != rows[j].UserCount {
			return rows[i].UserCount > rows[j].UserCount
		}
		if rows[i].EventCount != rows[j].EventCount {
			return rows[i].EventCount > rows[j].EventCount
		}
		if rows[i].LastSeen != rows[j].LastSeen {
			return rows[i].LastSeen > rows[j].LastSeen
		}
		return rows[i].Address < rows[j].Address
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func CountAuditEvents(startTimestamp, endTimestamp int64) (int64, error) {
	if LOG_DB == nil {
		return 0, nil
	}
	query := LOG_DB.Model(&AuditLog{})
	if startTimestamp > 0 {
		query = query.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		query = query.Where("created_at <= ?", endTimestamp)
	}
	var count int64
	return count, query.Count(&count).Error
}

func CountAuditAction(action string, startTimestamp, endTimestamp int64) (int64, error) {
	if LOG_DB == nil {
		return 0, nil
	}
	query := LOG_DB.Model(&AuditLog{}).Where("action = ?", action)
	if startTimestamp > 0 {
		query = query.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		query = query.Where("created_at <= ?", endTimestamp)
	}
	var count int64
	return count, query.Count(&count).Error
}

func CountAuditActionPrefix(prefix string, startTimestamp, endTimestamp int64) (int64, error) {
	if LOG_DB == nil {
		return 0, nil
	}
	query := LOG_DB.Model(&AuditLog{}).Where("action LIKE ?", prefix+"%")
	if startTimestamp > 0 {
		query = query.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		query = query.Where("created_at <= ?", endTimestamp)
	}
	var count int64
	return count, query.Count(&count).Error
}

func CountDistinctAuditIPs(startTimestamp, endTimestamp int64) (int64, error) {
	if LOG_DB == nil {
		return 0, nil
	}
	query := LOG_DB.Model(&AuditLog{}).Where("ip <> ''")
	if startTimestamp > 0 {
		query = query.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp > 0 {
		query = query.Where("created_at <= ?", endTimestamp)
	}
	var count int64
	return count, query.Distinct("ip").Count(&count).Error
}

func MigrateSecurityIPBlocks() error {
	if DB == nil {
		return gorm.ErrInvalidDB
	}
	return DB.AutoMigrate(&SecurityIPBlock{})
}
