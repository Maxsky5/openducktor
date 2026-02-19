import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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

const registerTools = (server: McpServer, store: OdtTaskStore): void => {
  server.registerTool(
    "odt_read_task",
    {
      description:
        "Read one OpenDucktor task with its current status and agent documents (spec/plan/latest QA).",
      inputSchema: {
        taskId: z.string().trim().min(1),
      },
    },
    async (input) => {
      try {
        const parsed = ODT_TOOL_SCHEMAS.odt_read_task.parse(input);
        const result = await store.readTask(parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "odt_set_spec",
    {
      description:
        "Persist specification markdown for a task and transition open->spec_ready when needed.",
      inputSchema: {
        taskId: z.string().trim().min(1),
        markdown: z.string().trim().min(1),
      },
    },
    async (input) => {
      try {
        const parsed = ODT_TOOL_SCHEMAS.odt_set_spec.parse(input);
        const result = await store.setSpec(parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "odt_set_plan",
    {
      description:
        "Persist implementation plan markdown and transition task to ready_for_dev (with optional epic subtask proposals).",
      inputSchema: {
        taskId: z.string().trim().min(1),
        markdown: z.string().trim().min(1),
        subtasks: z
          .array(
            z.object({
              title: z.string().trim().min(1),
              issueType: z.enum(["task", "feature", "bug"]).optional(),
              priority: z.number().int().min(0).max(4).optional(),
              description: z.string().optional(),
            }),
          )
          .optional(),
      },
    },
    async (input) => {
      try {
        const parsed = ODT_TOOL_SCHEMAS.odt_set_plan.parse(input);
        const result = await store.setPlan(parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "odt_build_blocked",
    {
      description: "Transition task to blocked with explicit reason.",
      inputSchema: {
        taskId: z.string().trim().min(1),
        reason: z.string().trim().min(1),
      },
    },
    async (input) => {
      try {
        const parsed = ODT_TOOL_SCHEMAS.odt_build_blocked.parse(input);
        const result = await store.buildBlocked(parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "odt_build_resumed",
    {
      description: "Transition blocked task back to in_progress.",
      inputSchema: {
        taskId: z.string().trim().min(1),
      },
    },
    async (input) => {
      try {
        const parsed = ODT_TOOL_SCHEMAS.odt_build_resumed.parse(input);
        const result = await store.buildResumed(parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "odt_build_completed",
    {
      description: "Transition in_progress task to ai_review/human_review according to qaRequired.",
      inputSchema: {
        taskId: z.string().trim().min(1),
        summary: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const parsed = ODT_TOOL_SCHEMAS.odt_build_completed.parse(input);
        const result = await store.buildCompleted(parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "odt_qa_approved",
    {
      description: "Append approved QA report and transition ai_review->human_review.",
      inputSchema: {
        taskId: z.string().trim().min(1),
        reportMarkdown: z.string().trim().min(1),
      },
    },
    async (input) => {
      try {
        const parsed = ODT_TOOL_SCHEMAS.odt_qa_approved.parse(input);
        const result = await store.qaApproved(parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "odt_qa_rejected",
    {
      description: "Append rejected QA report and transition ai_review->in_progress.",
      inputSchema: {
        taskId: z.string().trim().min(1),
        reportMarkdown: z.string().trim().min(1),
      },
    },
    async (input) => {
      try {
        const parsed = ODT_TOOL_SCHEMAS.odt_qa_rejected.parse(input);
        const result = await store.qaRejected(parsed);
        return toToolResult(result);
      } catch (error) {
        return toToolError(error);
      }
    },
  );
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
