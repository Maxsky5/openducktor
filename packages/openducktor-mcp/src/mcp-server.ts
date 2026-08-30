import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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

type OdtToolDefinitions<Names extends readonly RegisteredToolName[]> = {
  readonly [Index in keyof Names]: OdtToolDefinition<Names[Index]>;
};

type ToolDefinitionOptions<Name extends RegisteredToolName, InputSchema extends z.ZodObject> = {
  description: string;
  execute(store: OdtTaskStore, input: ToolInput<InputSchema>): Promise<ToolOutput<Name>>;
  nativeResult?: (payload: ToolOutput<Name>) => ToolResult;
};

const WORKSPACE_SCOPED_TOOL_NAMES = new Set<RegisteredToolName>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);
const ALLOWED_TOOLS_ENV = "ODT_ALLOWED_TOOLS";
// Deliberately allow workflow-scoped calls with workspaceId through schema validation so
// rejectForbiddenWorkspaceIdInput can return the canonical structured ODT error envelope.
const SHARED_SERVER_INSTRUCTIONS =
  "Public task access uses odt_create_task, odt_search_tasks, odt_read_task, odt_read_task_assets, and odt_read_task_documents. Use odt_read_task first for the single task summary object, including task state, nested qaVerdict, and nested document presence booleans. Use odt_read_task_assets to read referenced description images in one batch when their raw total is at most 20 MiB; split only larger sets. Use odt_read_task_documents only for needed document bodies. Internal workflow mutations use odt_* tools.";

const createServerInstructions = (options: { forbidWorkspaceIdInput: boolean }): string => {
  const workspaceInstruction = options.forbidWorkspaceIdInput
    ? "This MCP is already scoped to its startup workspace. Do not provide workspaceId in tool calls."
    : "Use odt_get_workspaces to discover available workspaces only when no startup workspace is configured. Workspace-scoped tools accept optional top-level workspaceId; when provided, it overrides the startup workspace.";

  return `OpenDucktor workflow server. ${workspaceInstruction} ${SHARED_SERVER_INSTRUCTIONS}`;
};

const parseAllowedToolNames = (): RegisteredToolName[] => {
  const raw = process.env[ALLOWED_TOOLS_ENV]?.trim();
  if (!raw) {
    return [...ODT_MCP_TOOL_NAMES];
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
  const execute = async (input: ToolInput<InputSchema>): Promise<ToolResult> => {
    try {
      rejectForbiddenWorkspaceIdInput(name, input, options);
      const payload = await definition.execute(store, input);
      return definition.nativeResult
        ? definition.nativeResult(payload)
        : toToolResult(mcpToolPayloadSchema.parse(payload));
    } catch (cause) {
      return toToolError(cause);
    }
  };
  if (definition.nativeResult) {
    server.registerTool(
      name,
      {
        title: name,
        description: definition.description,
        inputSchema: inputSchema.shape,
      },
      async (input: ToolInput<InputSchema>) => execute(input),
    );
    return;
  }

  server.registerTool(
    name,
    {
      title: name,
      description: definition.description,
      inputSchema: inputSchema.shape,
      outputSchema: ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[name],
    },
    async (input: ToolInput<InputSchema>) => execute(input),
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

const toListedToolDefinition = (
  tool: ListedOdtTool,
  options: { forbidWorkspaceIdInput: boolean },
) => {
  const definition = {
    name: tool.name,
    title: tool.name,
    description: tool.description,
    inputSchema: getListedToolInputSchema(tool.name, {
      hideWorkspaceId: options.forbidWorkspaceIdInput,
    }),
  };
  return tool.resultKind === "structured"
    ? { ...definition, outputSchema: getListedToolOutputSchema(tool.name) }
    : definition;
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

const ODT_TOOL_DEFINITIONS = [
  defineOdtTool("odt_get_workspaces", ODT_TOOL_SCHEMAS.odt_get_workspaces, {
    description:
      "List the workspaces currently known to OpenDucktor. Use the returned workspaceId values to scope later workspace-bound tool calls.",
    execute: (store, input) => store.getWorkspaces(input),
  }),
  defineOdtTool("odt_create_task", ODT_TOOL_SCHEMAS.odt_create_task, {
    description:
      "Create a new OpenDucktor task, feature, or bug using the same lightweight public task summary model as odt_read_task. Epic creation is not supported by this public tool.",
    execute: (store, input) => store.createTask(input),
  }),
  defineOdtTool("odt_search_tasks", ODT_TOOL_SCHEMAS.odt_search_tasks, {
    description:
      "Search active OpenDucktor tasks using exact filters for priority/issueType/status plus title substring and tag AND matching. The response is paginated as { results, limit, totalCount, hasMore }, and each item in results uses the same lightweight single-task summary model as odt_read_task, with qaVerdict and documents nested under task.",
    execute: (store, input) => store.searchTasks(input),
  }),
  defineOdtTool("odt_read_task", ODT_TOOL_SCHEMAS.odt_read_task, {
    description:
      "Read one OpenDucktor task as a single summary object containing current public task fields plus nested qaVerdict and document presence booleans for spec/plan/latest QA.",
    execute: (store, input) => store.readTask(input),
  }),
  defineOdtTool("odt_read_task_assets", ODT_TOOL_SCHEMAS.odt_read_task_assets, {
    description:
      "Read task description images by taskId and a non-empty assetIds batch whose raw total is at most 20 MiB. Returns one native MCP image content block per requested asset, in request order, and fails the whole call if any asset is unavailable.",
    execute: (store, input) => store.readTaskAssets(input),
    nativeResult: toTaskAssetsToolResult,
  }),
  defineOdtTool("odt_read_task_documents", ODT_TOOL_SCHEMAS.odt_read_task_documents, {
    description:
      "Read only the requested OpenDucktor task document bodies. Provide taskId plus one or more true include flags for spec, implementation plan, or latest QA report.",
    execute: (store, input) => store.readTaskDocuments(input),
  }),
  defineOdtTool("odt_set_spec", ODT_TOOL_SCHEMAS.odt_set_spec, {
    description:
      "Persist specification markdown for a task. Transitions open->spec_ready only when starting from open; allowed revisions from later active/review states leave status unchanged.",
    execute: (store, input) => store.setSpec(input),
  }),
  defineOdtTool("odt_set_plan", ODT_TOOL_SCHEMAS.odt_set_plan, {
    description:
      "Persist implementation plan markdown. Valid pre-build planning transitions to ready_for_dev; allowed revisions from active/review states leave status unchanged.",
    execute: (store, input) => store.setPlan(input),
  }),
  defineOdtTool("odt_build_blocked", ODT_TOOL_SCHEMAS.odt_build_blocked, {
    description: "Transition task to blocked with explicit reason.",
    execute: (store, input) => store.buildBlocked(input),
  }),
  defineOdtTool("odt_build_resumed", ODT_TOOL_SCHEMAS.odt_build_resumed, {
    description: "Transition blocked task back to in_progress.",
    execute: (store, input) => store.buildResumed(input),
  }),
  defineOdtTool("odt_build_completed", ODT_TOOL_SCHEMAS.odt_build_completed, {
    description: "Transition in_progress task to ai_review/human_review according to qaRequired.",
    execute: (store, input) => store.buildCompleted(input),
  }),
  defineOdtTool("odt_set_pull_request", ODT_TOOL_SCHEMAS.odt_set_pull_request, {
    description:
      "Persist the canonical pull request metadata for a task after Builder creates or updates the pull request with provider-native tools. The tool resolves authoritative metadata from providerId and pull request number.",
    execute: (store, input) => store.setPullRequest(input),
  }),
  defineOdtTool("odt_qa_approved", ODT_TOOL_SCHEMAS.odt_qa_approved, {
    description: "Append approved QA report and transition ai_review->human_review.",
    execute: (store, input) => store.qaApproved(input),
  }),
  defineOdtTool("odt_qa_rejected", ODT_TOOL_SCHEMAS.odt_qa_rejected, {
    description: "Append rejected QA report and transition ai_review->in_progress.",
    execute: (store, input) => store.qaRejected(input),
  }),
] satisfies OdtToolDefinitions<typeof ODT_MCP_TOOL_NAMES>;

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
  const resolved = await resolveStoreContext(context);
  const store = new OdtTaskStore(resolved);
  const forbidWorkspaceIdInput =
    resolved.forbidWorkspaceIdInput === true && resolved.workspaceId !== undefined;

  const server = new McpServer(
    {
      name: "openducktor",
      version: packageJson.version,
    },
    {
      instructions: createServerInstructions({ forbidWorkspaceIdInput }),
    },
  );

  registerTools(server, store, {
    forbidWorkspaceIdInput,
    allowedToolNames: options.allowedToolNames ?? parseAllowedToolNames(),
  });
  return server;
};
