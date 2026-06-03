import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { resolveWorkflowToolSelection } from "./workflow-tool-selection";

const makeClient = (input: {
  toolIds?: unknown;
  modelTools?: unknown;
  throwOnIds?: boolean;
  throwOnList?: boolean;
  onList?: () => void;
  mcpStatusResponse?: unknown;
  mcpStatusResponses?: unknown[];
  throwOnMcpStatus?: boolean;
  throwOnMcpConnect?: boolean;
  onMcpStatus?: (args: { directory: string }) => void;
  onMcpConnect?: (args: { directory: string; name: string }) => void;
}): OpencodeClient => {
  let statusResponseIndex = 0;
  return {
    tool: {
      ids: async () => {
        if (input.throwOnIds) {
          throw new Error("boom");
        }
        return {
          data: input.toolIds ?? [],
          error: undefined,
        };
      },
      list: async () => {
        input.onList?.();
        if (input.throwOnList) {
          throw new Error("list-boom");
        }
        return {
          data: input.modelTools ?? [],
          error: undefined,
        };
      },
    },
    mcp: {
      status: async (args: { directory: string }) => {
        input.onMcpStatus?.(args);
        if (input.throwOnMcpStatus) {
          throw new Error("mcp-down");
        }
        if (input.mcpStatusResponses) {
          const response = input.mcpStatusResponses[statusResponseIndex];
          statusResponseIndex += 1;
          return {
            data: response,
            error: undefined,
          };
        }
        return {
          data: input.mcpStatusResponse ?? { openducktor: { status: "connected" } },
          error: undefined,
        };
      },
      connect: async (args: { directory: string; name: string }) => {
        input.onMcpConnect?.(args);
        if (input.throwOnMcpConnect) {
          throw new Error("mcp-connect-down");
        }
        return {
          data: true,
          error: undefined,
        };
      },
    },
  } as unknown as OpencodeClient;
};

describe("workflow-tool-selection", () => {
  test("uses runtime tool aliases when available", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: [
          "openducktor_odt_read_task",
          "openducktor_odt_read_task_documents",
          "openducktor_odt_set_spec",
          "openducktor_odt_set_plan",
        ],
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.openducktor_odt_read_task).toBe(true);
    expect(selection.openducktor_odt_read_task_documents).toBe(true);
    expect(selection.openducktor_odt_set_spec).toBe(true);
    expect(selection.openducktor_odt_set_plan).toBe(false);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_documents).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("uses functions-prefixed runtime tool aliases when available", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: [
          "functions.openducktor_odt_read_task",
          "functions.openducktor_odt_read_task_documents",
          "functions.openducktor_odt_set_spec",
          "functions.openducktor_odt_set_plan",
        ],
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection["functions.openducktor_odt_read_task"]).toBe(true);
    expect(selection["functions.openducktor_odt_read_task_documents"]).toBe(true);
    expect(selection["functions.openducktor_odt_set_spec"]).toBe(true);
    expect(selection["functions.openducktor_odt_set_plan"]).toBe(false);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_documents).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("accepts exact canonical runtime tool ids", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_read_task_documents", "odt_set_spec", "odt_set_plan"],
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_documents).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("enables the supported OpenCode subagent tool and disables the unsupported alias", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["task", "subtask", "odt_read_task", "odt_read_task_documents", "odt_set_plan"],
      }),
      role: "planner",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.task).toBe(true);
    expect(selection.subtask).toBe(false);
    expect(selection.odt_set_plan).toBe(true);
  });

  test("keeps canonical trusted role tools when global ids miss ODT tools", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["bash", "read", "glob"],
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_documents).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
    expect(selection.openducktor_odt_set_spec).toBe(true);
    expect(selection["functions.openducktor_odt_set_spec"]).toBe(true);
    expect(selection.openducktor_odt_set_plan).toBe(false);
    expect(selection["functions.openducktor_odt_set_plan"]).toBe(false);
    expect(selection.openducktor_odt_build_completed).toBe(false);
    expect(selection["functions.openducktor_odt_build_completed"]).toBe(false);
    expect(selection.odt_create_task).toBe(false);
    expect(selection.odt_search_tasks).toBe(false);
    expect(selection.odt_get_workspaces).toBe(false);
    expect(selection.openducktor_odt_create_task).toBe(false);
    expect(selection.openducktor_odt_search_tasks).toBe(false);
    expect(selection.openducktor_odt_get_workspaces).toBe(false);
    expect(selection["functions.openducktor_odt_create_task"]).toBe(false);
    expect(selection["functions.openducktor_odt_search_tasks"]).toBe(false);
    expect(selection["functions.openducktor_odt_get_workspaces"]).toBe(false);
  });

  test("propagates tool discovery errors", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({ throwOnIds: true }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    }).catch((error: unknown) => error);

    expect(selection).toBeInstanceOf(Error);
    expect((selection as Error).message).toBe("boom");
  });

  test("throws actionable error when trusted MCP server is disconnected", async () => {
    const selectionError = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_set_spec"],
        mcpStatusResponse: { openducktor: { status: "failed", error: "connection closed" } },
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    }).catch((error: unknown) => error);

    expect(selectionError).toBeInstanceOf(Error);
    expect((selectionError as Error).message).toContain('unavailable for "/repo"');
    expect((selectionError as Error).message).toContain(
      'MCP server "openducktor" stayed unavailable after reconnect',
    );
    expect((selectionError as Error).message).toContain("connection closed");
  });

  test("reconnects a failed trusted MCP server for the same worktree before tool selection", async () => {
    const mcpStatusDirectories: string[] = [];
    const mcpConnectCalls: Array<{ directory: string; name: string }> = [];
    const reconnectEvents: Array<{
      serverName: string;
      workingDirectory: string;
      status: string;
      errorDetails: string | undefined;
    }> = [];

    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_set_plan"],
        mcpStatusResponses: [
          { openducktor: { status: "failed", error: "MCP error -32000: Connection closed" } },
          { openducktor: { status: "connected" } },
        ],
        onMcpStatus: (args) => mcpStatusDirectories.push(args.directory),
        onMcpConnect: (args) => mcpConnectCalls.push(args),
      }),
      role: "build",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo/.openducktor/worktrees/task-1",
      onReconnectStart: (event) => reconnectEvents.push(event),
    });

    expect(mcpStatusDirectories).toEqual([
      "/repo/.openducktor/worktrees/task-1",
      "/repo/.openducktor/worktrees/task-1",
    ]);
    expect(mcpConnectCalls).toEqual([
      {
        directory: "/repo/.openducktor/worktrees/task-1",
        name: "openducktor",
      },
    ]);
    expect(reconnectEvents).toEqual([
      {
        serverName: "openducktor",
        workingDirectory: "/repo/.openducktor/worktrees/task-1",
        status: "failed",
        errorDetails: "MCP error -32000: Connection closed",
      },
    ]);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("propagates same-directory MCP reconnect failures", async () => {
    const selectionError = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task"],
        mcpStatusResponse: {
          openducktor: { status: "failed", error: "MCP error -32000: Connection closed" },
        },
        throwOnMcpConnect: true,
      }),
      role: "build",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo/.openducktor/worktrees/task-1",
    }).catch((error: unknown) => error);

    expect(selectionError).toBeInstanceOf(Error);
    expect((selectionError as Error).message).toBe("mcp-connect-down");
  });

  test("propagates trusted MCP status lookup failures", async () => {
    const selectionError = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_set_spec"],
        throwOnMcpStatus: true,
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    }).catch((error: unknown) => error);

    expect(selectionError).toBeInstanceOf(Error);
    expect((selectionError as Error).message).toBe("mcp-down");
  });

  test("keeps canonical trusted role tools when runtime discovery misses ODT ids", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_read_task_documents", "odt_set_plan"],
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_documents).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("keeps trusted workflow aliases role-scoped when runtime discovery misses ODT ids", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["bash", "read", "glob"],
      }),
      role: "build",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.openducktor_odt_build_completed).toBe(true);
    expect(selection["functions.openducktor_odt_build_completed"]).toBe(true);
    expect(selection.openducktor_odt_qa_approved).toBe(false);
    expect(selection["functions.openducktor_odt_qa_approved"]).toBe(false);
  });

  test("ignores malformed or untrusted runtime aliases", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: [
          "odt_read_task",
          "odt_read_task_documents",
          "odt_set_spec",
          "openducktor_odt_set_spec_extra",
          "customprefix_odt_set_plan",
          "OpenDucktor_ODT_SET_SPEC",
        ],
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_documents).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.openducktor_odt_set_spec_extra).toBe(false);
    expect(selection.customprefix_odt_set_plan).toBeUndefined();
    expect(selection.OpenDucktor_ODT_SET_SPEC).toBeUndefined();
    expect(selection.edit).toBe(false);
    expect(selection.apply_patch).toBe(false);
    expect(selection.bash).toBeUndefined();
  });

  test("denies newly discovered public OpenDucktor MCP tools for current workflow roles", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: [
          "openducktor_odt_read_task",
          "openducktor_odt_read_task_documents",
          "openducktor_odt_create_task",
          "openducktor_odt_get_workspaces",
          "functions.openducktor_odt_search_tasks",
          "functions.openducktor_odt_get_workspaces",
        ],
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.openducktor_odt_read_task).toBe(true);
    expect(selection.openducktor_odt_read_task_documents).toBe(true);
    expect(selection.openducktor_odt_create_task).toBe(false);
    expect(selection.openducktor_odt_get_workspaces).toBe(false);
    expect(selection["functions.openducktor_odt_search_tasks"]).toBe(false);
    expect(selection["functions.openducktor_odt_get_workspaces"]).toBe(false);
  });

  test("denies canonical public tool ids when discovery exposes them without a server prefix", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: [
          "odt_create_task",
          "odt_search_tasks",
          "odt_get_workspaces",
          "odt_read_task",
          "odt_read_task_documents",
        ],
      }),
      role: "spec",
      runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      workingDirectory: "/repo",
    });

    expect(selection.odt_create_task).toBe(false);
    expect(selection.odt_search_tasks).toBe(false);
    expect(selection.odt_get_workspaces).toBe(false);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_read_task_documents).toBe(true);
  });
});
