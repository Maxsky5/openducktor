import {
  agentToolNameValues,
  isOdtBrowserToolName,
  type AgentToolName,
  type WorkflowRoleInput,
} from "@openducktor/contracts";

/** What each OpenDucktor tool lets an agent do, in plain words. */
export const TOOL_LABELS = {
  odt_create_task: "Create new tasks",
  odt_search_tasks: "Search the tasks",
  odt_read_task: "Read a task",
  odt_read_task_assets: "View task images",
  odt_read_task_artifacts: "Read task documents",
  odt_set_task_artifact: "Save task documents",
  odt_delete_task_artifact: "Delete task documents",
  odt_update_task: "Edit task details",
  odt_apply_workflow_event: "Move the task",
  odt_set_pull_request: "Link the pull request",
  odt_browser_list: "List tabs",
  odt_browser_open: "Open a tab",
  odt_browser_navigate: "Go to a page",
  odt_browser_close: "Close a tab",
  odt_browser_snapshot: "Read the page content",
  odt_browser_click: "Click on the page",
  odt_browser_hover: "Hover on the page",
  odt_browser_type: "Type text",
  odt_browser_press: "Press keys",
  odt_browser_select: "Choose list options",
  odt_browser_scroll: "Scroll the page",
  odt_browser_screenshot: "Take screenshots",
  odt_browser_console: "Read the console",
  odt_browser_wait: "Wait for the page",
  odt_browser_dialog: "Answer page dialogs",
} satisfies Record<AgentToolName, string>;

const WORKFLOW_TOOLS: ReadonlySet<AgentToolName> = new Set([
  "odt_apply_workflow_event",
  "odt_set_pull_request",
]);

export type ToolGroup = { readonly title: string; readonly tools: readonly AgentToolName[] };

/** The tools in three groups: the task, the workflow, and the browser. */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    title: "Task tools",
    tools: agentToolNameValues.filter(
      (tool) => !WORKFLOW_TOOLS.has(tool) && !isOdtBrowserToolName(tool),
    ),
  },
  {
    title: "Workflow tools",
    tools: agentToolNameValues.filter((tool) => WORKFLOW_TOOLS.has(tool)),
  },
  { title: "Browser tools", tools: agentToolNameValues.filter(isOdtBrowserToolName) },
];

/**
 * What a role may do with the files of the task worktree, where every task session runs. Each
 * runtime blocks its file edit tools for a read-only role.
 */
export const FILE_ACCESS_OPTIONS = [
  {
    value: "read",
    label: "Read only",
    hint: "The agent reads the code. The runtime blocks every file edit.",
  },
  {
    value: "write",
    label: "Can edit files",
    hint: "The agent can change the files of the task.",
  },
] as const satisfies readonly {
  value: WorkflowRoleInput["workspaceAccess"];
  label: string;
  hint: string;
}[];
