import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { resolveWorkflowToolSelection } from "./workflow-tool-selection";

const makeClient = (input: {
  toolIds?: unknown;
  modelTools?: unknown;
  throwOnIds?: boolean;
  throwOnList?: boolean;
  mcpStatusResponse?: unknown;
  throwOnMcpStatus?: boolean;
}): OpencodeClient => {
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
      status: async () => {
        if (input.throwOnMcpStatus) {
          throw new Error("mcp-down");
        }
        return {
          data: input.mcpStatusResponse ?? { openducktor: { status: "connected" } },
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
          "openducktor_odt_set_spec",
          "openducktor_odt_set_plan",
        ],
      }),
      role: "spec",
      workingDirectory: "/repo",
    });

    expect(selection.openducktor_odt_read_task).toBe(true);
    expect(selection.openducktor_odt_set_spec).toBe(true);
    expect(selection.openducktor_odt_set_plan).toBe(false);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("uses functions-prefixed runtime tool aliases when available", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: [
          "functions.openducktor_odt_read_task",
          "functions.openducktor_odt_set_spec",
          "functions.openducktor_odt_set_plan",
        ],
      }),
      role: "spec",
      workingDirectory: "/repo",
    });

    expect(selection["functions.openducktor_odt_read_task"]).toBe(true);
    expect(selection["functions.openducktor_odt_set_spec"]).toBe(true);
    expect(selection["functions.openducktor_odt_set_plan"]).toBe(false);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("accepts exact canonical runtime tool ids", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_set_spec", "odt_set_plan"],
      }),
      role: "spec",
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("uses model-scoped tool ids when global ids miss ODT tools", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["bash", "read", "glob"],
        modelTools: [
          { id: "openducktor_odt_read_task" },
          { id: "openducktor_odt_set_spec" },
          { id: "openducktor_odt_set_plan" },
        ],
      }),
      role: "spec",
      workingDirectory: "/repo",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    });

    expect(selection.openducktor_odt_read_task).toBe(true);
    expect(selection.openducktor_odt_set_spec).toBe(true);
    expect(selection.openducktor_odt_set_plan).toBe(false);
    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("propagates tool discovery errors", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({ throwOnIds: true }),
      role: "spec",
      workingDirectory: "/repo",
    }).catch((error: unknown) => error);

    expect(selection).toBeInstanceOf(Error);
    expect((selection as Error).message).toBe("boom");
  });

  test("propagates model-scoped tool discovery errors", async () => {
    const selectionError = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["bash", "read", "glob"],
        throwOnList: true,
      }),
      role: "spec",
      workingDirectory: "/repo",
      model: {
        providerId: "openai",
        modelId: "gpt-5",
      },
    }).catch((error: unknown) => error);

    expect(selectionError).toBeInstanceOf(Error);
    expect((selectionError as Error).message).toBe("list-boom");
  });

  test("throws actionable error when trusted MCP server is disconnected", async () => {
    const selectionError = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_set_spec"],
        mcpStatusResponse: { openducktor: { status: "failed", error: "connection closed" } },
      }),
      role: "spec",
      workingDirectory: "/repo",
    }).catch((error: unknown) => error);

    expect(selectionError).toBeInstanceOf(Error);
    expect((selectionError as Error).message).toContain('MCP server "openducktor" is "failed"');
    expect((selectionError as Error).message).toContain("connection closed");
  });

  test("propagates trusted MCP status lookup failures", async () => {
    const selectionError = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_set_spec"],
        throwOnMcpStatus: true,
      }),
      role: "spec",
      workingDirectory: "/repo",
    }).catch((error: unknown) => error);

    expect(selectionError).toBeInstanceOf(Error);
    expect((selectionError as Error).message).toBe("mcp-down");
  });

  test("keeps canonical trusted role tools when runtime discovery misses ODT ids", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_set_plan"],
      }),
      role: "spec",
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.odt_set_plan).toBe(false);
  });

  test("ignores malformed or untrusted runtime aliases", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: [
          "odt_read_task",
          "odt_set_spec",
          "openducktor_odt_set_spec_extra",
          "customprefix_odt_set_plan",
          "OpenDucktor_ODT_SET_SPEC",
        ],
      }),
      role: "spec",
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.openducktor_odt_set_spec_extra).toBeUndefined();
    expect(selection.customprefix_odt_set_plan).toBeUndefined();
    expect(selection.OpenDucktor_ODT_SET_SPEC).toBeUndefined();
  });
});
