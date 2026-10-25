package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestPageChannelGroupsSplitsGroupsAndKeepsDisabledSeparate(t *testing.T) {
	channels := []*model.Channel{
		{Id: 1, Name: "multi", Group: "alpha, beta", Status: common.ChannelStatusEnabled},
		{Id: 2, Name: "beta-only", Group: "beta", Status: common.ChannelStatusEnabled},
		{Id: 3, Name: "disabled", Group: "gamma", Status: 0},
		{Id: 4, Name: "empty", Group: "", Status: common.ChannelStatusEnabled},
	}

	pageOne, total := pageChannelGroups(channels, 1, 2)
	require.Equal(t, int64(4), total)
	require.Len(t, pageOne, 3)
	require.Equal(t, "alpha", pageOne[0].Group)
	require.Equal(t, "beta", pageOne[1].Group)
	require.Equal(t, "beta", pageOne[2].Group)
	require.Equal(t, 1, pageOne[1].Id)
	require.Equal(t, 2, pageOne[2].Id)

	pageTwo, total := pageChannelGroups(channels, 2, 2)
	require.Equal(t, int64(4), total)
	require.Len(t, pageTwo, 2)
	require.Equal(t, "未分组", pageTwo[0].Group)
	require.Equal(t, "未启用", pageTwo[1].Group)
	require.Equal(t, 4, pageTwo[0].Id)
	require.Equal(t, 3, pageTwo[1].Id)
}
