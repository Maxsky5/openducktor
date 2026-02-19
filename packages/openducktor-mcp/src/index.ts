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

const registerOdtTool = (server: McpServer, store: OdtTaskStore, tool: RegisteredTool): void => {
  const schema = ODT_TOOL_SCHEMAS[tool.name];

  server.registerTool(
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

const registerTools = (server: McpServer, store: OdtTaskStore): void => {
  const tools: RegisteredTool[] = [
    {
      name: "odt_read_task",
      description:
        "Read one OpenDucktor task with its current status and agent documents (spec/plan/latest QA).",
      execute: (currentStore, input) => currentStore.readTask(input),
    },
    {
      name: "odt_set_spec",
      description:
        "Persist specification markdown for a task and transition open->spec_ready when needed.",
      execute: (currentStore, input) => currentStore.setSpec(input),
    },
    {
      name: "odt_set_plan",
      description:
        "Persist implementation plan markdown and transition task to ready_for_dev (with optional epic subtask proposals).",
      execute: (currentStore, input) => currentStore.setPlan(input),
    },
    {
      name: "odt_build_blocked",
      description: "Transition task to blocked with explicit reason.",
      execute: (currentStore, input) => currentStore.buildBlocked(input),
    },
    {
      name: "odt_build_resumed",
      description: "Transition blocked task back to in_progress.",
      execute: (currentStore, input) => currentStore.buildResumed(input),
    },
    {
      name: "odt_build_completed",
      description: "Transition in_progress task to ai_review/human_review according to qaRequired.",
      execute: (currentStore, input) => currentStore.buildCompleted(input),
    },
    {
      name: "odt_qa_approved",
      description: "Append approved QA report and transition ai_review->human_review.",
      execute: (currentStore, input) => currentStore.qaApproved(input),
    },
    {
      name: "odt_qa_rejected",
      description: "Append rejected QA report and transition ai_review->in_progress.",
      execute: (currentStore, input) => currentStore.qaRejected(input),
    },
  ];

  for (const tool of tools) {
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
        "OpenDucktor workflow server. Use odt_read_task for context, then odt_* transition tools to mutate workflow state.",
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
