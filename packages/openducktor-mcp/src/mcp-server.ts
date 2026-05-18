import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import packageJson from "../package.json" with { type: "json" };
import { ODT_MCP_TOOL_NAMES, ODT_TOOL_SCHEMAS, ODT_WORKSPACE_SCOPED_TOOL_NAMES } from "./lib";
import { getListedToolInputSchema, type RegisteredToolName } from "./listed-tool-schema";
import { OdtTaskStore } from "./odt-task-store";
import { type OdtStoreContext, resolveStoreContext } from "./store-context";
import { OdtToolError, type ToolResult, toToolError, toToolResult } from "./tool-results";

type ToolInputByName<Name extends RegisteredToolName> = ReturnType<
  (typeof ODT_TOOL_SCHEMAS)[Name]["parse"]
>;

type RegisteredTool<Name extends RegisteredToolName = RegisteredToolName> = {
  name: Name;
  description: string;
  execute(store: OdtTaskStore, input: ToolInputByName<Name>): Promise<unknown>;
};

type RegisteredToolSpecs = {
  [Name in RegisteredToolName]: {
    description: string;
    execute(store: OdtTaskStore, input: ToolInputByName<Name>): Promise<unknown>;
  };
};

type RegisterContractTool = (
  name: string,
  config: { description: string; inputSchema: unknown },
  callback: (input: unknown) => Promise<ToolResult>,
) => void;

const WORKSPACE_SCOPED_TOOL_NAMES = new Set<RegisteredToolName>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);
const KNOWN_TOOL_NAMES = new Set<string>(ODT_MCP_TOOL_NAMES);
const ALLOWED_TOOLS_ENV = "ODT_ALLOWED_TOOLS";
// Deliberately allow workflow-scoped calls with workspaceId through schema validation so
// rejectForbiddenWorkspaceIdInput can return the canonical structured ODT error envelope.
const SHARED_SERVER_INSTRUCTIONS =
  "Public task access uses odt_create_task, odt_search_tasks, odt_read_task, and odt_read_task_documents. Use odt_read_task first for the single task summary object, including task state, nested qaVerdict, and nested document presence booleans, then odt_read_task_documents only for needed document bodies. Internal workflow mutations use odt_* tools.";

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

  for (const toolName of toolNames) {
    if (!KNOWN_TOOL_NAMES.has(toolName)) {
      throw new Error(`${ALLOWED_TOOLS_ENV} contains unknown OpenDucktor MCP tool '${toolName}'.`);
    }
  }

  return [...new Set(toolNames)] as RegisteredToolName[];
};

const hasOwnWorkspaceIdInput = (input: unknown): boolean => {
  return typeof input === "object" && input !== null && Object.hasOwn(input, "workspaceId");
};

const rejectForbiddenWorkspaceIdInput = (
  toolName: RegisteredToolName,
  input: unknown,
  options: { forbidWorkspaceIdInput: boolean },
): void => {
  if (
    options.forbidWorkspaceIdInput &&
    WORKSPACE_SCOPED_TOOL_NAMES.has(toolName) &&
    hasOwnWorkspaceIdInput(input)
  ) {
    throw new OdtToolError(
      "ODT_WORKSPACE_SCOPE_VIOLATION",
      `Invalid arguments for tool ${toolName}: workspaceId is not allowed in workflow-scoped tool calls.`,
      {
        toolName,
        issues: [
          {
            path: ["workspaceId"],
            code: "forbidden_workspace_id",
            message: "workspaceId is not allowed in workflow-scoped tool calls.",
          },
        ],
      },
    );
  }
};

const registerOdtTool = <Name extends RegisteredToolName>(
  server: McpServer,
  store: OdtTaskStore,
  tool: RegisteredTool<Name>,
  options: { forbidWorkspaceIdInput: boolean },
): void => {
  const schema = ODT_TOOL_SCHEMAS[tool.name];
  const registerContractTool = server.registerTool.bind(server) as RegisterContractTool;

  registerContractTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: schema,
    },
    async (input: unknown) => {
      try {
        rejectForbiddenWorkspaceIdInput(tool.name, input, options);
        const parsedInput = schema.parse(input) as ToolInputByName<Name>;
        const result = await tool.execute(store, parsedInput);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );
};

type ListedOdtTool = {
  name: RegisteredToolName;
  description: string;
};

const toListedToolDefinition = (
  tool: ListedOdtTool,
  options: { forbidWorkspaceIdInput: boolean },
) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: getListedToolInputSchema(tool.name, {
    hideWorkspaceId: options.forbidWorkspaceIdInput,
  }),
});

const installVisibleToolListHandler = (
  server: McpServer,
  tools: readonly ListedOdtTool[],
  options: { forbidWorkspaceIdInput: boolean },
): void => {
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => toListedToolDefinition(tool, options)),
  }));
};

const ODT_REGISTERED_TOOL_SPECS: Readonly<RegisteredToolSpecs> = {
  odt_get_workspaces: {
    description:
      "List the workspaces currently known to OpenDucktor. Use the returned workspaceId values to scope later workspace-bound tool calls.",
    execute: (store, input) => store.getWorkspaces(input),
  },
  odt_read_task: {
    description:
      "Read one OpenDucktor task as a single summary object containing current public task fields plus nested qaVerdict and document presence booleans for spec/plan/latest QA.",
    execute: (store, input) => store.readTask(input),
  },
  odt_read_task_documents: {
    description:
      "Read only the requested OpenDucktor task document bodies. Provide taskId plus one or more true include flags for spec, implementation plan, or latest QA report.",
    execute: (store, input) => store.readTaskDocuments(input),
  },
  odt_create_task: {
    description:
      "Create a new OpenDucktor task, feature, or bug using the same lightweight public task summary model as odt_read_task. Epic creation is not supported by this public tool.",
    execute: (store, input) => store.createTask(input),
  },
  odt_search_tasks: {
    description:
      "Search active OpenDucktor tasks using exact filters for priority/issueType/status plus title substring and tag AND matching. The response is paginated as { results, limit, totalCount, hasMore }, and each item in results uses the same lightweight single-task summary model as odt_read_task, with qaVerdict and documents nested under task.",
    execute: (store, input) => store.searchTasks(input),
  },
  odt_set_spec: {
    description:
      "Persist specification markdown for a task. Transitions open->spec_ready only when starting from open; allowed revisions from later active/review states leave status unchanged.",
    execute: (store, input) => store.setSpec(input),
  },
  odt_set_plan: {
    description:
      "Persist implementation plan markdown. Valid pre-build planning transitions to ready_for_dev; allowed revisions from active/review states leave status unchanged.",
    execute: (store, input) => store.setPlan(input),
  },
  odt_build_blocked: {
    description: "Transition task to blocked with explicit reason.",
    execute: (store, input) => store.buildBlocked(input),
  },
  odt_build_resumed: {
    description: "Transition blocked task back to in_progress.",
    execute: (store, input) => store.buildResumed(input),
  },
  odt_build_completed: {
    description: "Transition in_progress task to ai_review/human_review according to qaRequired.",
    execute: (store, input) => store.buildCompleted(input),
  },
  odt_set_pull_request: {
    description:
      "Persist the canonical pull request metadata for a task after Builder creates or updates the pull request with provider-native tools. The tool resolves authoritative metadata from providerId and pull request number.",
    execute: (store, input) => store.setPullRequest(input),
  },
  odt_qa_approved: {
    description: "Append approved QA report and transition ai_review->human_review.",
    execute: (store, input) => store.qaApproved(input),
  },
  odt_qa_rejected: {
    description: "Append rejected QA report and transition ai_review->in_progress.",
    execute: (store, input) => store.qaRejected(input),
  },
};

const registerTools = (
  server: McpServer,
  store: OdtTaskStore,
  options: { forbidWorkspaceIdInput: boolean; allowedToolNames: readonly RegisteredToolName[] },
): void => {
  const registeredTools: ListedOdtTool[] = [];

  const registerOneTool = <Name extends RegisteredToolName>(toolName: Name): void => {
    const spec = ODT_REGISTERED_TOOL_SPECS[toolName];
    const tool: RegisteredTool<Name> = {
      name: toolName,
      description: spec.description,
      execute: spec.execute,
    };
    registerOdtTool(server, store, tool, options);
    registeredTools.push(tool);
  };

  for (const toolName of options.allowedToolNames) {
    registerOneTool(toolName);
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
