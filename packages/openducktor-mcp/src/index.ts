import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import packageJson from "../package.json" with { type: "json" };
import { ODT_TOOL_SCHEMAS, type OdtStoreContext, OdtTaskStore, resolveStoreContext } from "./lib";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown error";
};

const toToolResult = (payload: unknown): ToolResult => {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    ...(payload && typeof payload === "object"
      ? { structuredContent: payload as Record<string, unknown> }
      : {}),
  };
};

const toToolError = (error: unknown): ToolResult => {
  const message = toErrorMessage(error);
  const code =
    error instanceof Error && error.name === "ZodError"
      ? "ODT_TOOL_INPUT_INVALID"
      : "ODT_TOOL_EXECUTION_ERROR";
  const errorPayload = {
    ok: false,
    error: {
      code,
      message,
    },
  };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(errorPayload, null, 2),
      },
    ],
    structuredContent: errorPayload,
    isError: true,
  };
};

const parseCliArgs = (argv: string[]): OdtStoreContext => {
  const next: OdtStoreContext = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }

    const value = argv[index + 1];
    if (!value) {
      continue;
    }

    if (current === "--repo") {
      next.repoPath = value;
      index += 1;
      continue;
    }

    if (current === "--beads-dir") {
      next.beadsDir = value;
      index += 1;
      continue;
    }

    if (current === "--metadata-namespace") {
      next.metadataNamespace = value;
      index += 1;
    }
  }

  return next;
};

type RegisteredToolName = keyof typeof ODT_TOOL_SCHEMAS;
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

const isSchemaLike = (value: unknown): value is ZodRawShapeCompat[string] => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { parse?: unknown; _def?: unknown; _zod?: unknown };
  return (
    typeof candidate.parse === "function" ||
    candidate._def !== undefined ||
    candidate._zod !== undefined
  );
};

const isRegisterToolInputSchema = (value: unknown): value is ZodRawShapeCompat => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((entry) => isSchemaLike(entry));
};

const assertRegisterToolInputSchema: (
  toolName: RegisteredToolName,
  value: unknown,
) => asserts value is ZodRawShapeCompat = (toolName, value) => {
  if (!isRegisterToolInputSchema(value)) {
    throw new TypeError(`Invalid MCP input schema for tool '${toolName}'.`);
  }
};

export const registerOdtTool = <Name extends RegisteredToolName>(
  server: McpServer,
  store: OdtTaskStore,
  tool: RegisteredTool<Name>,
): void => {
  const schema = ODT_TOOL_SCHEMAS[tool.name];
  const inputSchema: unknown = schema.shape;
  assertRegisterToolInputSchema(tool.name, inputSchema);

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema,
    },
    async (input: unknown) => {
      try {
        const parsedInput = schema.parse(input) as ToolInputByName<Name>;
        const result = await tool.execute(store, parsedInput);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );
};

export const ODT_REGISTERED_TOOL_SPECS: Readonly<RegisteredToolSpecs> = {
  odt_read_task: {
    description:
      "Read one OpenDucktor task with its current public fields and agent documents (spec/plan/latest QA).",
    execute: (store, input) => store.readTask(input),
  },
  create_task: {
    description:
      "Create a new OpenDucktor task, feature, or bug using the same public task/document response model as odt_read_task. Epic creation is not supported by this public tool.",
    execute: (store, input) => store.createTask(input),
  },
  search_tasks: {
    description:
      "Search active OpenDucktor tasks using exact filters for priority/issueType/status plus title substring and tag AND matching. The response is paginated as { results, limit, totalCount, hasMore }, and each item in results uses the same { task, documents } snapshot model as odt_read_task.",
    execute: (store, input) => store.searchTasks(input),
  },
  odt_set_spec: {
    description:
      "Persist specification markdown for a task and transition open->spec_ready when needed.",
    execute: (store, input) => store.setSpec(input),
  },
  odt_set_plan: {
    description:
      "Persist implementation plan markdown and transition task to ready_for_dev (with optional epic subtask proposals). Subtask priority values must be integers in [0, 4], default 2.",
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

export const ODT_REGISTERED_TOOL_NAMES = Object.keys(
  ODT_REGISTERED_TOOL_SPECS,
) as RegisteredToolName[];

const registerTools = (server: McpServer, store: OdtTaskStore): void => {
  const registerOneTool = <Name extends RegisteredToolName>(toolName: Name): void => {
    const spec = ODT_REGISTERED_TOOL_SPECS[toolName];
    const tool: RegisteredTool<Name> = {
      name: toolName,
      description: spec.description,
      execute: spec.execute,
    };
    registerOdtTool(server, store, tool);
  };

  for (const toolName of ODT_REGISTERED_TOOL_NAMES) {
    registerOneTool(toolName);
  }
};

export const createOpenducktorMcpServer = async (
  context: OdtStoreContext = {},
): Promise<McpServer> => {
  const resolved = await resolveStoreContext(context);
  const store = new OdtTaskStore(resolved);

  const server = new McpServer(
    {
      name: "openducktor",
      version: packageJson.version,
    },
    {
      instructions:
        "OpenDucktor workflow server. Public task access uses create_task, search_tasks, and odt_read_task. Internal workflow mutations use odt_* tools. For odt_set_plan subtasks, priority must be an integer 0..4 (default 2).",
    },
  );

  registerTools(server, store);
  return server;
};

export const startOpenducktorMcp = async (context: OdtStoreContext = {}): Promise<void> => {
  const server = await createOpenducktorMcpServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

if (import.meta.main) {
  const context = parseCliArgs(process.argv.slice(2));
  void startOpenducktorMcp(context).catch((error) => {
    // MCP stdio requires stderr for diagnostics.
    console.error(`[openducktor-mcp] ${toErrorMessage(error)}`);
    process.exit(1);
  });
}
