# apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/

## Responsibility
Task lifecycle workflows backed by Beads task storage.

## Design
The folder groups approval, QA, document, session, PR sync, reset, delete, and cleanup services around one task domain.

## Flow
Task actions resolve the current task state, apply workflow rules, mutate Beads metadata/documents, and return updated task summaries or workflow results.

## Integration
Consumes `TaskStore`, `TaskCard`, workflow document types, and git/runtime metadata from `host_domain` and infra adapters.
