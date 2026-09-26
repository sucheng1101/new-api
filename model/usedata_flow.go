package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type FlowQuotaData struct {
	UserID      int    `json:"user_id,omitempty" gorm:"column:user_id"`
	Username    string `json:"username,omitempty" gorm:"column:username"`
	NodeName    string `json:"node_name,omitempty" gorm:"column:node_name"`
	TokenID     int    `json:"token_id,omitempty" gorm:"column:token_id"`
	TokenName   string `json:"token_name,omitempty" gorm:"-"`
	Group       string `json:"group" gorm:"column:group"`
	ChannelID   int    `json:"channel_id,omitempty" gorm:"column:channel_id"`
	ChannelName string `json:"channel_name,omitempty" gorm:"-"`
	ModelName   string `json:"model_name" gorm:"column:model_name"`
	TokenUsed   int    `json:"token_used" gorm:"column:token_used"`
	Count       int    `json:"count" gorm:"column:count"`
	Quota       int    `json:"quota" gorm:"column:quota"`
}

func GetFlowQuotaData(startTime, endTime int64, username string, userID, role int) ([]*FlowQuotaData, error) {
	switch {
	case role >= common.RoleRootUser:
		return getRootFlowQuotaData(startTime, endTime, username)
	case role >= common.RoleAdminUser:
		return getAdminFlowQuotaData(startTime, endTime, username)
	default:
		return getSelfFlowQuotaData(startTime, endTime, userID)
	}
}

func flowQuotaBaseQuery(startTime, endTime int64) *gorm.DB {
	return DB.Table("quota_data").Where("created_at >= ? and created_at <= ?", startTime, endTime)
}

func getSelfFlowQuotaData(startTime, endTime int64, userID int) ([]*FlowQuotaData, error) {
	rows := make([]*FlowQuotaData, 0)
	err := flowQuotaBaseQuery(startTime, endTime).Select(commonGroupCol+", model_name, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used").Where("user_id = ?", userID).Group(commonGroupCol + ", model_name").Order("quota DESC").Find(&rows).Error
	return rows, err
}

func getAdminFlowQuotaData(startTime, endTime int64, username string) ([]*FlowQuotaData, error) {
	rows := make([]*FlowQuotaData, 0)
	query := flowQuotaBaseQuery(startTime, endTime).Select("user_id, username, " + commonGroupCol + ", model_name, channel_id, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used")
	if username != "" {
		query = query.Where("username = ?", username)
	}
	err := query.Group("user_id, username, " + commonGroupCol + ", model_name, channel_id").Order("quota DESC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, fillFlowChannelNames(rows)
}

func getRootFlowQuotaData(startTime, endTime int64, username string) ([]*FlowQuotaData, error) {
	rows := make([]*FlowQuotaData, 0)
	query := flowQuotaBaseQuery(startTime, endTime).Select("user_id, username, node_name, token_id, " + commonGroupCol + ", model_name, channel_id, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used")
	if username != "" {
		query = query.Where("username = ?", username)
	}
	err := query.Group("user_id, username, node_name, token_id, " + commonGroupCol + ", model_name, channel_id").Order("quota DESC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	if err = fillFlowTokenNames(rows); err != nil {
		return rows, err
	}
	return rows, fillFlowChannelNames(rows)
}

func fillFlowTokenNames(rows []*FlowQuotaData) error {
	ids := make([]int, 0)
	seen := make(map[int]struct{})
	for _, row := range rows {
		if row.TokenID > 0 {
			if _, ok := seen[row.TokenID]; !ok {
				seen[row.TokenID] = struct{}{}
				ids = append(ids, row.TokenID)
			}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var tokens []struct {
		Id   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	if err := DB.Model(&Token{}).Select("id, name").Where("id IN ?", ids).Find(&tokens).Error; err != nil {
		return err
	}
	for _, token := range tokens {
		for _, row := range rows {
			if row.TokenID == token.Id {
				row.TokenName = token.Name
			}
		}
	}
	return nil
}

func fillFlowChannelNames(rows []*FlowQuotaData) error {
	ids := make([]int, 0)
	seen := make(map[int]struct{})
	for _, row := range rows {
		if row.ChannelID > 0 {
			if _, ok := seen[row.ChannelID]; !ok {
				seen[row.ChannelID] = struct{}{}
				ids = append(ids, row.ChannelID)
			}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var channels []struct {
		Id   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	if err := DB.Table("channels").Select("id, name").Where("id IN ?", ids).Find(&channels).Error; err != nil {
		return err
	}
	for _, row := range rows {
		for _, channel := range channels {
			if row.ChannelID == channel.Id {
				row.ChannelName = channel.Name
			}
		}
		if row.ChannelID > 0 && row.ChannelName == "" {
			row.ChannelName = fmt.Sprintf("channel-%d", row.ChannelID)
		}
	}
	return nil
}
