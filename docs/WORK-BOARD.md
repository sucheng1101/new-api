# Work Board — newapi

This board is the project-level coordination entry point for Codex and WorkBuddy. It does not replace the project skill or AGENTS.md.

## Project profile

- Class: product/application + service/api
- Operational profile: hosted-service, data-sensitive
- Primary write rule: one task, one primary write session, one task branch.
- Docker rule: use the verified project Docker/Compose workflow for software run, test, build, and health checks.
- Release rule: GitHub publication and online version sync are separate operations; Gitee is not part of the release path.

## Active tasks

| Task ID | Status | Mode | Branch | Base commit | Primary writer/session | Review session | Owned paths | Docker evidence | Next action |
|---|---|---|---|---|---|---|---|---|---|
| — | IDLE | — | — | — | — | — | — | — | Create a task card before the next write |

## Current repository baseline (discovery only)

- Observed branch: $branch
- Observed HEAD: $head
- Board initialized: 2026-10-12
- Existing working-tree changes are preserved and are not assigned to this board row.

## Handoff reminders

- WorkBuddy returns implementation/test evidence to Codex.
- Codex performs review, integration, GitHub publication, release, online sync, rollback, and closure.
- When two task branches reach REVIEW or RELEASE_READY, create an integration session before starting another writer on the same paths.
