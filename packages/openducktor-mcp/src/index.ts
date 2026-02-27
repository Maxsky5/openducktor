import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ODT_TOOL_SCHEMAS, type OdtStoreContext, OdtTaskStore, resolveStoreContext } from "./lib";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
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
  };
};

const toToolError = (error: unknown): ToolResult => {
  return {
    content: [
      {
        type: "text",
        text: toErrorMessage(error),
      },
    ],
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

type RegisteredTool = {
  name: keyof typeof ODT_TOOL_SCHEMAS;
  description: string;
  execute: (store: OdtTaskStore, input: unknown) => Promise<unknown>;
};

type RegisteredToolName = keyof typeof ODT_TOOL_SCHEMAS;

type RegisteredToolSpec = {
  description: string;
  execute: (store: OdtTaskStore, input: unknown) => Promise<unknown>;
};

type ToolInputSchema = {
  shape: Record<string, unknown>;
  parse: (input: unknown) => unknown;
};

type RegisterToolCall = (
  this: McpServer,
  name: string,
  config: {
    description: string;
    inputSchema: unknown;
  },
  handler: (input: unknown) => Promise<ToolResult>,
) => void;

export const registerOdtTool = (
  server: McpServer,
  store: OdtTaskStore,
  tool: RegisteredTool,
): void => {
  const schema = ODT_TOOL_SCHEMAS[tool.name] as unknown as ToolInputSchema;
  const registerTool = server.registerTool as unknown as RegisterToolCall;

  registerTool.call(
    server,
    tool.name,
    {
      description: tool.description,
      inputSchema: schema.shape,
    },
    async (input: unknown) => {
      try {
        const parsed = schema.parse(input);
        const result = await tool.execute(store, parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );
};

export const ODT_REGISTERED_TOOL_SPECS: Readonly<Record<RegisteredToolName, RegisteredToolSpec>> = {
  odt_read_task: {
    description:
      "Read one OpenDucktor task with its current status and agent documents (spec/plan/latest QA).",
    execute: (store, input) => store.readTask(input),
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
  for (const toolName of ODT_REGISTERED_TOOL_NAMES) {
    const spec = ODT_REGISTERED_TOOL_SPECS[toolName];
    const tool: RegisteredTool = {
      name: toolName,
      description: spec.description,
      execute: spec.execute,
    };
    registerOdtTool(server, store, tool);
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
      version: "0.1.0",
    },
    {
      instructions:
        "OpenDucktor workflow server. Use odt_read_task for context, then odt_* transition tools to mutate workflow state. For odt_set_plan subtasks, priority must be an integer 0..4 (default 2).",
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
