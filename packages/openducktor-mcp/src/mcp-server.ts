import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type RequestMeta } from "@modelcontextprotocol/sdk/types.js";
import {
  ODT_BROWSER_TOOL_NAMES,
  ODT_BROWSER_TOOL_TIMEOUT_MS,
  ODT_BROWSER_WAIT_DEFAULT_TIMEOUT_MS,
  ODT_EXTERNAL_MCP_TOOL_NAMES,
  ODT_READ_ONLY_TOOL_NAMES,
  type OdtBrowserToolName,
} from "@openducktor/contracts";
import type { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import {
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_MCP_TOOL_NAMES,
  ODT_TOOL_SCHEMAS,
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
} from "./lib";
import {
  getListedToolInputSchema,
  getListedToolOutputSchema,
  type RegisteredToolName,
} from "./listed-tool-schema";
import { OdtTaskStore } from "./odt-task-store";
import { type OdtStoreContext, resolveStoreContext } from "./store-context";
import {
  mcpToolPayloadSchema,
  OdtToolError,
  type ToolResult,
  toBrowserToolResult,
  toTaskAssetsToolResult,
  toToolError,
  toToolResult,
} from "./tool-results";

type RegisteredToolInputSchema = (typeof ODT_TOOL_SCHEMAS)[RegisteredToolName];
type ToolInput<InputSchema extends z.ZodObject> = Parameters<ToolCallback<InputSchema["shape"]>>[0];
type ToolOutput<Name extends RegisteredToolName> = z.output<
  (typeof ODT_HOST_BRIDGE_RESPONSE_SCHEMAS)[Name]
>;

type OdtToolDefinition<Name extends RegisteredToolName = RegisteredToolName> = {
  name: Name;
  description: string;
  resultKind: "structured" | "native-content";
  register(
    server: McpServer,
    store: OdtTaskStore,
    options: { forbidWorkspaceIdInput: boolean },
  ): void;
};

type ToolDefinitionOptions<Name extends RegisteredToolName, InputSchema extends z.ZodObject> = {
  description: string;
  /** `meta` is the `_meta` of the MCP request. */
  execute(
    store: OdtTaskStore,
    input: ToolInput<InputSchema>,
    meta: RequestMeta | undefined,
  ): Promise<ToolOutput<Name>>;
  nativeResult?: (payload: ToolOutput<Name>) => ToolResult;
};

const WORKSPACE_SCOPED_TOOL_NAMES = new Set<RegisteredToolName>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);
const ALLOWED_TOOLS_ENV = "ODT_ALLOWED_TOOLS";
/**
 * Codex repeats the server instructions in front of each tool description, so they stay short. A
 * session that forbids workspaceId needs none: its tool schemas hide workspaceId, and each tool
 * describes itself.
 */
const WORKSPACE_SERVER_INSTRUCTIONS =
  "Pass a workspaceId from odt_get_workspaces when no startup workspace is set, or to use another workspace.";

const READ_ONLY_TOOL_NAMES = new Set<RegisteredToolName>(ODT_READ_ONLY_TOOL_NAMES);

/** Managed runtimes always list their tools. Other clients never get browser tools. */
const parseAllowedToolNames = (): RegisteredToolName[] => {
  const raw = process.env[ALLOWED_TOOLS_ENV]?.trim();
  if (!raw) {
    return [...ODT_EXTERNAL_MCP_TOOL_NAMES];
  }

  const toolNames = raw
    .split(",")
    .map((toolName) => toolName.trim())
    .filter((toolName) => toolName.length > 0);
  if (toolNames.length === 0) {
    throw new Error(`${ALLOWED_TOOLS_ENV} must list at least one tool when provided.`);
  }

  const parsedToolNames = new Set<RegisteredToolName>();
  for (const toolName of toolNames) {
    const registeredToolName = ODT_MCP_TOOL_NAMES.find((candidate) => candidate === toolName);
    if (!registeredToolName) {
      throw new Error(`${ALLOWED_TOOLS_ENV} contains unknown OpenDucktor MCP tool '${toolName}'.`);
    }
    parsedToolNames.add(registeredToolName);
  }

  return [...parsedToolNames];
};

type RegisteredToolInput = ToolInput<RegisteredToolInputSchema>;

const rejectForbiddenWorkspaceIdInput = (
  toolName: RegisteredToolName,
  input: RegisteredToolInput,
  options: { forbidWorkspaceIdInput: boolean },
): void => {
  if (
    options.forbidWorkspaceIdInput &&
    WORKSPACE_SCOPED_TOOL_NAMES.has(toolName) &&
    Object.hasOwn(input, "workspaceId")
  ) {
    const message =
      "workspaceId is fixed by the startup workspace and is not allowed in tool input.";
    throw new OdtToolError({
      code: "ODT_WORKSPACE_SCOPE_VIOLATION",
      message: `Invalid arguments for tool ${toolName}: ${message}`,
      details: { toolName },
      issues: [
        {
          path: ["workspaceId"],
          code: "forbidden_workspace_id",
          message,
        },
      ],
    });
  }
};

const registerOdtTool = <
  Name extends RegisteredToolName,
  InputSchema extends RegisteredToolInputSchema,
>(
  server: McpServer,
  store: OdtTaskStore,
  name: Name,
  inputSchema: InputSchema,
  definition: ToolDefinitionOptions<Name, InputSchema>,
  options: { forbidWorkspaceIdInput: boolean },
): void => {
  const execute = async (
    input: ToolInput<InputSchema>,
    meta: RequestMeta | undefined,
  ): Promise<ToolResult> => {
    try {
      rejectForbiddenWorkspaceIdInput(name, input, options);
      const payload = await definition.execute(store, input, meta);
      return definition.nativeResult
        ? definition.nativeResult(payload)
        : toToolResult(mcpToolPayloadSchema.parse(payload));
    } catch (cause) {
      return toToolError(cause);
    }
  };
  // SAFETY: the MCP SDK parses tool input with the registered inputSchema before it calls this
  // handler, and its callback type cannot carry a generic schema, so the handler asserts the type.
  const handleInput: ToolCallback<z.ZodTypeAny> = async (input, extra) =>
    execute(input as ToolInput<InputSchema>, extra._meta);
  if (definition.nativeResult) {
    server.registerTool<z.ZodTypeAny, z.ZodTypeAny>(
      name,
      {
        title: name,
        description: definition.description,
        inputSchema,
      },
      handleInput,
    );
    return;
  }

  server.registerTool<z.ZodTypeAny, z.ZodTypeAny>(
    name,
    {
      title: name,
      description: definition.description,
      inputSchema,
      outputSchema: ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[name],
    },
    handleInput,
  );
};

const defineOdtTool = <Name extends RegisteredToolName>(
  name: Name,
  inputSchema: (typeof ODT_TOOL_SCHEMAS)[Name],
  definition: ToolDefinitionOptions<Name, (typeof ODT_TOOL_SCHEMAS)[Name]>,
): OdtToolDefinition<Name> => {
  const resultKind = definition.nativeResult ? "native-content" : "structured";

  return {
    name,
    description: definition.description,
    resultKind,
    register: (server, store, options) =>
      registerOdtTool(server, store, name, inputSchema, definition, options),
  };
};

type ListedOdtTool = {
  name: RegisteredToolName;
  description: string;
  resultKind: "structured" | "native-content";
};

type ListedToolDefinition = {
  name: RegisteredToolName;
  title: string;
  description: string;
  inputSchema: ReturnType<typeof getListedToolInputSchema>;
  outputSchema?: ReturnType<typeof getListedToolOutputSchema>;
  annotations?: { readOnlyHint: true };
};

const toListedToolDefinition = (
  tool: ListedOdtTool,
  options: { forbidWorkspaceIdInput: boolean },
): ListedToolDefinition => {
  const definition: ListedToolDefinition = {
    name: tool.name,
    title: tool.name,
    description: tool.description,
    inputSchema: getListedToolInputSchema(tool.name, {
      hideWorkspaceId: options.forbidWorkspaceIdInput,
    }),
  };
  if (tool.resultKind === "structured") {
    definition.outputSchema = getListedToolOutputSchema(tool.name);
  }
  if (READ_ONLY_TOOL_NAMES.has(tool.name)) {
    definition.annotations = { readOnlyHint: true };
  }
  return definition;
};

const installVisibleToolListHandler = (
  server: McpServer,
  tools: readonly ListedOdtTool[],
  options: { forbidWorkspaceIdInput: boolean },
): void => {
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => toListedToolDefinition(tool, options)),
  }));
};

const BROWSER_TOOL_DESCRIPTIONS = {
  odt_browser_list:
    "List the browser tabs that this session can use: its agent tabs and the user tabs that the user shares.",
  odt_browser_open: "Open a new agent tab at an http or https URL. Returns its tabId.",
  odt_browser_navigate: "Load a url in a tab, or run a history action. Give one of them.",
  odt_browser_close: "Close one of your agent tabs.",
  odt_browser_snapshot:
    "Read the accessibility tree of a tab with element refs such as e12. Take a new snapshot when a ref is stale.",
  odt_browser_click: "Click an element ref.",
  odt_browser_hover: "Move the pointer over an element ref.",
  odt_browser_type: "Replace the text of a field ref.",
  odt_browser_press: "Press a key or key combination in the focused element of a tab.",
  odt_browser_select: "Pick options of a <select> element ref.",
  odt_browser_scroll:
    "Scroll an element ref into view, or scroll the page by deltaX and deltaY pixels.",
  odt_browser_screenshot: "Capture the visible page or one element ref as an image.",
  odt_browser_console: "Read the console messages and uncaught errors of a tab.",
  odt_browser_wait: `Wait until a tab shows text or an element ref, reaches a url, or reaches a load state. Give at most one; the default is the load state. timeoutMs: default ${ODT_BROWSER_WAIT_DEFAULT_TIMEOUT_MS}, at most ${ODT_BROWSER_TOOL_TIMEOUT_MS}.`,
  odt_browser_dialog:
    "Accept or dismiss the open JavaScript dialog of a tab. promptText answers a prompt dialog.",
} satisfies Record<OdtBrowserToolName, string>;

const defineBrowserTool = (name: OdtBrowserToolName): OdtToolDefinition<OdtBrowserToolName> =>
  defineOdtTool(name, ODT_TOOL_SCHEMAS[name], {
    description: BROWSER_TOOL_DESCRIPTIONS[name],
    execute: (store, input, meta) => store.callBrowserTool(name, input, meta),
    nativeResult: toBrowserToolResult,
  });

const ODT_TOOL_DEFINITIONS = [
  defineOdtTool("odt_get_workspaces", ODT_TOOL_SCHEMAS.odt_get_workspaces, {
    description: "List the OpenDucktor workspaces with their workspaceId.",
    execute: (store, input) => store.getWorkspaces(input),
  }),
  defineOdtTool("odt_create_task", ODT_TOOL_SCHEMAS.odt_create_task, {
    description:
      "Create a task, feature, or bug, and return its summary like odt_read_task. Epics are not supported.",
    execute: (store, input) => store.createTask(input),
  }),
  defineOdtTool("odt_search_tasks", ODT_TOOL_SCHEMAS.odt_search_tasks, {
    description:
      "Search active tasks. Filters match exactly, title matches a substring, and a task must have all tags. Returns a page of task summaries like odt_read_task.",
    execute: (store, input) => store.searchTasks(input),
  }),
  defineOdtTool("odt_read_task", ODT_TOOL_SCHEMAS.odt_read_task, {
    description:
      "Read the summary of one task: its fields, QA verdict, and which documents it has. Call it first.",
    execute: (store, input) => store.readTask(input),
  }),
  defineOdtTool("odt_read_task_assets", ODT_TOOL_SCHEMAS.odt_read_task_assets, {
    description:
      "Read description images of a task as image content, in request order. A batch is at most 20 MiB. The call fails when an asset is unavailable.",
    execute: (store, input) => store.readTaskAssets(input),
    nativeResult: toTaskAssetsToolResult,
  }),
  defineOdtTool("odt_read_task_documents", ODT_TOOL_SCHEMAS.odt_read_task_documents, {
    description:
      "Read the requested documents of a task: spec, implementation plan, or latest QA report. Set at least one include flag.",
    execute: (store, input) => store.readTaskDocuments(input),
  }),
  defineOdtTool("odt_update_task", ODT_TOOL_SCHEMAS.odt_update_task, {
    description:
      "Update fields of one task that is not an epic. Omitted fields stay. An empty description or labels clears it. It never changes status or documents.",
    execute: (store, input) => store.updateTask(input),
  }),
  defineOdtTool("odt_set_spec", ODT_TOOL_SCHEMAS.odt_set_spec, {
    description:
      "Save the spec markdown of a task. An open task moves to spec_ready; later revisions keep the status.",
    execute: (store, input) => store.setSpec(input),
  }),
  defineOdtTool("odt_set_plan", ODT_TOOL_SCHEMAS.odt_set_plan, {
    description:
      "Save the implementation plan markdown of a task. Before the build it moves to ready_for_dev; later revisions keep the status.",
    execute: (store, input) => store.setPlan(input),
  }),
  defineOdtTool("odt_build_blocked", ODT_TOOL_SCHEMAS.odt_build_blocked, {
    description: "Move the task to blocked, with the reason.",
    execute: (store, input) => store.buildBlocked(input),
  }),
  defineOdtTool("odt_build_resumed", ODT_TOOL_SCHEMAS.odt_build_resumed, {
    description: "Move a blocked task back to in_progress.",
    execute: (store, input) => store.buildResumed(input),
  }),
  defineOdtTool("odt_build_completed", ODT_TOOL_SCHEMAS.odt_build_completed, {
    description: "Move an in_progress task to ai_review or human_review, as qaRequired sets.",
    execute: (store, input) => store.buildCompleted(input),
  }),
  defineOdtTool("odt_set_pull_request", ODT_TOOL_SCHEMAS.odt_set_pull_request, {
    description:
      "Save the pull request of a task by its number, after you create or update it. The host reads its details from the repository provider.",
    execute: (store, input) => store.setPullRequest(input),
  }),
  defineOdtTool("odt_qa_approved", ODT_TOOL_SCHEMAS.odt_qa_approved, {
    description: "Add an approved QA report, and move ai_review to human_review.",
    execute: (store, input) => store.qaApproved(input),
  }),
  defineOdtTool("odt_qa_rejected", ODT_TOOL_SCHEMAS.odt_qa_rejected, {
    description: "Add a rejected QA report, and move ai_review to in_progress.",
    execute: (store, input) => store.qaRejected(input),
  }),
  ...ODT_BROWSER_TOOL_NAMES.map(defineBrowserTool),
] satisfies readonly OdtToolDefinition[];

const registerTools = (
  server: McpServer,
  store: OdtTaskStore,
  options: { forbidWorkspaceIdInput: boolean; allowedToolNames: readonly RegisteredToolName[] },
): void => {
  const allowedToolNames = new Set(options.allowedToolNames);
  const registeredTools: ListedOdtTool[] = [];

  for (const tool of ODT_TOOL_DEFINITIONS) {
    if (!allowedToolNames.has(tool.name)) {
      continue;
    }

    tool.register(server, store, options);
    registeredTools.push(tool);
  }

  installVisibleToolListHandler(server, registeredTools, options);
};

type CreateMcpServerOptions = {
  allowedToolNames?: readonly RegisteredToolName[];
};

export const createMcpServer = async (
  context: OdtStoreContext = {},
  options: CreateMcpServerOptions = {},
): Promise<McpServer> => {
  const allowedToolNames = options.allowedToolNames ?? parseAllowedToolNames();
  const resolved = await resolveStoreContext(context);
  const store = new OdtTaskStore(resolved);
  const forbidWorkspaceIdInput =
    resolved.forbidWorkspaceIdInput === true && resolved.workspaceId !== undefined;

  const server = new McpServer(
    {
      name: "openducktor",
      version: packageJson.version,
    },
    forbidWorkspaceIdInput ? {} : { instructions: WORKSPACE_SERVER_INSTRUCTIONS },
  );

  registerTools(server, store, { forbidWorkspaceIdInput, allowedToolNames });
  return server;
};
