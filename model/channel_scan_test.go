package model

import "testing"

func TestChannelInfoScanAcceptsSQLiteTextAndBytes(t *testing.T) {
	const payload = `{"is_multi_key":true,"multi_key_size":2,"multi_key_mode":"random"}`

	for name, value := range map[string]interface{}{
		"text":  payload,
		"bytes": []byte(payload),
	} {
		t.Run(name, func(t *testing.T) {
			var info ChannelInfo
			if err := info.Scan(value); err != nil {
				t.Fatalf("scan channel info: %v", err)
			}
			if !info.IsMultiKey || info.MultiKeySize != 2 {
				t.Fatalf("unexpected channel info: %+v", info)
			}
		})
	}
}

func TestChannelInfoScanAcceptsNullAndEmptyValues(t *testing.T) {
	for name, value := range map[string]interface{}{
		"null":  nil,
		"empty": " ",
	} {
		t.Run(name, func(t *testing.T) {
			var info ChannelInfo
			if err := info.Scan(value); err != nil {
				t.Fatalf("scan empty channel info: %v", err)
			}
			if info.IsMultiKey || info.MultiKeySize != 0 {
				t.Fatalf("unexpected empty channel info: %+v", info)
			}
		})
	}
}
