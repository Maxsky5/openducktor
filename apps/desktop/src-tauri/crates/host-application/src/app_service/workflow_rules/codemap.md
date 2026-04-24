# apps/desktop/src-tauri/crates/host-application/src/app_service/workflow_rules/

## Responsibility
Derive and validate task workflow transitions, actions, and normalized inputs.

## Design
Transitions encode allowed status moves and workflow state derivation; validators handle parent relationships, markdown normalization, and action availability.

## Flow
Task services consult these rules before mutating task status, planning subtasks, or triggering approval/QA actions.

## Integration
Used by task workflow services and surfaced through `host_domain::TaskAction` / `AgentWorkflows`.
