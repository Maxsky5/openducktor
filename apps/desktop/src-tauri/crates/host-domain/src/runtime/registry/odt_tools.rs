// Keep this list in sync with `ODT_WORKFLOW_AGENT_TOOL_NAMES` in
// `packages/contracts/src/odt-tool-names.ts`.
pub(super) const ODT_WORKFLOW_TOOL_NAMES: [&str; 10] = [
    "odt_read_task",
    "odt_read_task_documents",
    "odt_set_spec",
    "odt_set_plan",
    "odt_build_blocked",
    "odt_build_resumed",
    "odt_build_completed",
    "odt_set_pull_request",
    "odt_qa_approved",
    "odt_qa_rejected",
];
