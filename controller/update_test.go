package controller

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveUpdatePlanUsesConfiguredScript(t *testing.T) {
	root := t.TempDir()
	scriptName := "production-update.sh"
	if runtime.GOOS == "windows" {
		scriptName = "update-local.ps1"
	}
	script := filepath.Join(root, "scripts", scriptName)
	if err := os.MkdirAll(filepath.Dir(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(script, []byte("placeholder"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NEW_API_UPDATE_MODE", map[bool]string{true: "windows", false: "systemd"}[runtime.GOOS == "windows"])
	t.Setenv("NEW_API_UPDATE_ROOT", root)
	t.Setenv("NEW_API_UPDATE_SCRIPT", "")

	plan := resolveUpdatePlan()
	if !plan.Ready {
		t.Fatalf("expected update plan to be ready: %s", plan.Reason)
	}
	if plan.Script != script {
		t.Fatalf("unexpected script path: got %q want %q", plan.Script, script)
	}
	if plan.WorkDir != root {
		t.Fatalf("unexpected work dir: got %q want %q", plan.WorkDir, root)
	}
}

func TestResolveUpdatePlanReportsMissingDockerScript(t *testing.T) {
	root := t.TempDir()
	t.Setenv("NEW_API_UPDATE_MODE", "docker")
	t.Setenv("NEW_API_UPDATE_ROOT", root)
	t.Setenv("NEW_API_UPDATE_SCRIPT", "")

	plan := resolveUpdatePlan()
	if plan.Ready {
		t.Fatal("expected a missing Docker script to fail preflight")
	}
	if plan.Mode != "docker" {
		t.Fatalf("unexpected mode: %s", plan.Mode)
	}
	if plan.Reason == "" {
		t.Fatal("expected a descriptive preflight reason")
	}
}

func TestUpdateModeRejectsUnknownOverride(t *testing.T) {
	t.Setenv("NEW_API_UPDATE_MODE", "host-agent")
	if mode := updateMode(); mode != "unsupported" {
		t.Fatalf("unexpected mode: %s", mode)
	}
}
