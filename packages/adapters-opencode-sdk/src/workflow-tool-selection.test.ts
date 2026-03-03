import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { resolveWorkflowToolSelection } from "./workflow-tool-selection";

const makeClient = (input: {
  toolIds?: unknown;
  throwOnIds?: boolean;
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
    expect(selection.odt_read_task).toBeUndefined();
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

  test("propagates tool discovery errors", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({ throwOnIds: true }),
      role: "spec",
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

  test("throws actionable error when trusted runtime ids are missing for role tools", async () => {
    const selectionError = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["odt_read_task", "odt_set_plan"],
      }),
      role: "spec",
      workingDirectory: "/repo",
    }).catch((error: unknown) => error);

    expect(selectionError).toBeInstanceOf(Error);
    expect((selectionError as Error).message).toContain("missing trusted runtime tool IDs");
    expect((selectionError as Error).message).toContain("odt_set_spec");
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
