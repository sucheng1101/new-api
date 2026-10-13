package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupDirectIPAllowlistTest(t *testing.T) {
	t.Helper()
	previousDB := DB
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&User{}, &DirectIPAllowlist{}))
	DB = database
	t.Cleanup(func() { DB = previousDB })
}

func TestNormalizeDirectIPv4(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "canonicalizes leading zero-free address", input: " 192.0.2.10 ", want: "192.0.2.10"},
		{name: "rejects ipv6", input: "2001:db8::10", wantErr: true},
		{name: "rejects cidr", input: "192.0.2.0/24", wantErr: true},
		{name: "rejects empty", input: "", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeDirectIPv4(test.input)
			if test.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.want, got)
		})
	}
}

func TestDirectIPAllowlistCreateLimitDuplicateAndDelete(t *testing.T) {
	setupDirectIPAllowlistTest(t)

	for i := 1; i <= DirectIPAllowlistMaxEntries; i++ {
		_, err := CreateDirectIPAllowlist(7, "192.0.2."+string(rune('0'+i)), "test")
		require.NoError(t, err)
	}
	_, err := CreateDirectIPAllowlist(7, "198.51.100.1", "overflow")
	assert.ErrorContains(t, err, "最多")
	_, err = CreateDirectIPAllowlist(8, "192.0.2.1", "first")
	require.NoError(t, err)
	_, err = CreateDirectIPAllowlist(8, "192.0.2.1", "duplicate")
	assert.ErrorContains(t, err, "已经添加")

	entries, err := GetDirectIPAllowlists(7)
	require.NoError(t, err)
	require.Len(t, entries, DirectIPAllowlistMaxEntries)
	require.NoError(t, DeleteDirectIPAllowlist(7, entries[0].Id))
	assert.ErrorIs(t, DeleteDirectIPAllowlist(7, entries[0].Id), gorm.ErrRecordNotFound)
}

func TestCheckAndTouchDirectIPAllowlistExpiresStaleEntries(t *testing.T) {
	setupDirectIPAllowlistTest(t)

	old := DirectIPAllowlist{
		UserId:       9,
		IP:           "203.0.113.9",
		CreatedAt:    1,
		LastAccessAt: 1,
	}
	active := DirectIPAllowlist{
		UserId:       9,
		IP:           "203.0.113.10",
		CreatedAt:    common.GetTimestamp(),
		LastAccessAt: 0,
	}
	require.NoError(t, DB.Create(&old).Error)
	require.NoError(t, DB.Create(&active).Error)

	allowed, err := CheckAndTouchDirectIPAllowlist(9, "203.0.113.10")
	require.NoError(t, err)
	assert.True(t, allowed)
	allowed, err = CheckAndTouchDirectIPAllowlist(9, "203.0.113.9")
	require.NoError(t, err)
	assert.False(t, allowed)
	allowed, err = CheckAndTouchDirectIPAllowlist(9, "2001:db8::9")
	require.NoError(t, err)
	assert.False(t, allowed)

	var refreshed DirectIPAllowlist
	require.NoError(t, DB.First(&refreshed, active.Id).Error)
	assert.Greater(t, refreshed.LastAccessAt, int64(0))
	var staleCount int64
	require.NoError(t, DB.Model(&DirectIPAllowlist{}).Where("ip = ?", old.IP).Count(&staleCount).Error)
	assert.Zero(t, staleCount)
}

func TestCleanupStaleDirectIPAllowlists(t *testing.T) {
	setupDirectIPAllowlistTest(t)
	require.NoError(t, DB.Create(&DirectIPAllowlist{UserId: 1, IP: "192.0.2.1", CreatedAt: 1}).Error)
	require.NoError(t, DB.Create(&DirectIPAllowlist{UserId: 1, IP: "192.0.2.2", CreatedAt: 1, LastAccessAt: 1}).Error)
	removed, err := CleanupStaleDirectIPAllowlists()
	require.NoError(t, err)
	assert.Equal(t, int64(2), removed)
}
