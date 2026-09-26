package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetUserWallet(c *gin.Context) {
	balance, err := model.GetWalletBalance(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, balance)
}

func GetUserWalletTransactions(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows []model.WalletTransaction
	q := model.DB.Where("user_id = ?", c.GetInt("id")).Order("id desc").Limit(limit)
	if account := c.Query("account_type"); account != "" {
		q = q.Where("account_type = ?", account)
	}
	if err := q.Find(&rows).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}
