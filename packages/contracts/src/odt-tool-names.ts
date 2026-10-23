import {
  isOdtBrowserToolName,
  ODT_BROWSER_READ_TOOL_NAMES,
  ODT_BROWSER_TOOL_NAMES,
} from "./odt-browser-tool-schemas";

/** The name under which runtimes register the managed OpenDucktor MCP server. */
export const ODT_MCP_SERVER_NAME = "openducktor";

export const ODT_WORKSPACE_DISCOVERY_TOOL_NAME = "odt_get_workspaces" as const;

export const ODT_WORKFLOW_AGENT_TOOL_NAMES = [
  "odt_create_task",
  "odt_search_tasks",
  "odt_read_task",
  "odt_read_task_assets",
  "odt_read_task_artifacts",
  "odt_set_task_artifact",
  "odt_delete_task_artifact",
  "odt_update_task",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_set_pull_request",
  ...ODT_BROWSER_TOOL_NAMES,
] as const;

export const ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES = [ODT_WORKSPACE_DISCOVERY_TOOL_NAME] as const;

/** Task tools that read tasks and artifacts and change nothing. */
export const ODT_TASK_READ_TOOL_NAMES = [
  "odt_search_tasks",
  "odt_read_task",
  "odt_read_task_assets",
  "odt_read_task_artifacts",
] as const satisfies readonly (typeof ODT_WORKFLOW_AGENT_TOOL_NAMES)[number][];

/** Tools that change nothing. Clients such as Codex can run them without an approval. */
export const ODT_READ_ONLY_TOOL_NAMES = [
  ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
  ...ODT_TASK_READ_TOOL_NAMES,
  ...ODT_BROWSER_READ_TOOL_NAMES,
] as const;

export const ODT_MCP_TOOL_NAMES = [
  ...ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES,
  ...ODT_WORKFLOW_AGENT_TOOL_NAMES,
] as const;

export const ODT_TOOL_NAMES = ODT_MCP_TOOL_NAMES;

/** Tools that an MCP client without `ODT_ALLOWED_TOOLS` gets. Browser tools need a managed session. */
export const ODT_EXTERNAL_MCP_TOOL_NAMES = ODT_MCP_TOOL_NAMES.filter(
  (name) => !isOdtBrowserToolName(name),
);
