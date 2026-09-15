package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskPublicAddressOptionUpdatesRuntimeSetting(t *testing.T) {
	previousAddress := system_setting.TaskPublicAddress
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		system_setting.TaskPublicAddress = previousAddress
		common.OptionMap = previousOptions
	})

	require.NoError(t, updateOptionMap("TaskPublicAddress", "http://127.0.0.1:5200"))
	assert.Equal(t, "http://127.0.0.1:5200", system_setting.TaskPublicAddress)
	assert.Equal(t, "http://127.0.0.1:5200", common.OptionMap["TaskPublicAddress"])
}
