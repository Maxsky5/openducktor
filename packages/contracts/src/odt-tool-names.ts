export const ODT_WORKSPACE_DISCOVERY_TOOL_NAME = "odt_get_workspaces" as const;

export const ODT_WORKFLOW_AGENT_TOOL_NAMES = [
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
] as const;

export const ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES = [
  ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
  "odt_create_task",
  "odt_search_tasks",
] as const;

export const ODT_MCP_TOOL_NAMES = [
  ...ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES,
  ...ODT_WORKFLOW_AGENT_TOOL_NAMES,
] as const;

export const ODT_TOOL_NAMES = ODT_MCP_TOOL_NAMES;
