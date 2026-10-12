package common

import "testing"

func TestNormalizeEmailDomainWhitelist(t *testing.T) {
	got := NormalizeEmailDomainWhitelist([]string{" QQ.COM ", " @gmail.com ", "qq.com", "", " @ "})
	want := []string{"qq.com", "gmail.com"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestIsEmailDomainAllowed(t *testing.T) {
	whitelist := []string{"qq.com", "gmail.com"}
	if !IsEmailDomainAllowed(" QQ.COM ", whitelist) {
		t.Fatal("expected domain to be allowed case-insensitively")
	}
	if IsEmailDomainAllowed("outlook.com", whitelist) {
		t.Fatal("expected domain to be rejected when it is not whitelisted")
	}
	if !IsEmailDomainAllowed(" @GMAIL.COM ", whitelist) {
		t.Fatal("expected whitespace and optional @ to be normalized")
	}
	if IsEmailDomainAllowed("mail.qq.com", whitelist) || IsEmailDomainAllowed("", whitelist) {
		t.Fatal("expected exact non-empty domain matching")
	}
}
