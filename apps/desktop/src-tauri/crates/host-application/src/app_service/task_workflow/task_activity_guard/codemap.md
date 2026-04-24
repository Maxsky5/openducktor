# apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/task_activity_guard/

## Responsibility
Block destructive task operations when live builder or QA activity is still running.

## Design
Guard logic probes runtime/session status and classifies activity by role so delete/reset operations can fail fast with actionable messages.

## Flow
The guard collects task sessions, resolves probe targets, checks runtime snapshots, and returns a blocker summary when active work is detected.

## Integration
Used by task deletion/reset workflows and depends on runtime session-status probes plus `AgentSessionDocument` records.
