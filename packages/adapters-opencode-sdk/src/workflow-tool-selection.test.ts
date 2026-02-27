import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { resolveWorkflowToolSelection } from "./workflow-tool-selection";

const makeClient = (input: { toolIds?: unknown; throwOnIds?: boolean }): OpencodeClient => {
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
  } as unknown as OpencodeClient;
};

describe("workflow-tool-selection", () => {
  test("uses runtime tool aliases when available", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["customprefix_odt_set_spec", "customprefix_odt_set_plan"],
      }),
      role: "spec",
      workingDirectory: "/repo",
    });

    expect(selection.customprefix_odt_set_spec).toBe(true);
    expect(selection.customprefix_odt_set_plan).toBe(false);
  });

  test("falls back to known alias policy when tool discovery fails", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({ throwOnIds: true }),
      role: "qa",
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_qa_approved).toBe(true);
    expect(selection.odt_set_spec).toBe(false);
  });

  test("ignores malformed runtime aliases and keeps canonical role policy", async () => {
    const selection = await resolveWorkflowToolSelection({
      client: makeClient({
        toolIds: ["customprefix_odt_set_spec_extra", "customprefix_odt_", "customprefix_odt_set_plan"],
      }),
      role: "spec",
      workingDirectory: "/repo",
    });

    expect(selection.odt_read_task).toBe(true);
    expect(selection.odt_set_spec).toBe(true);
    expect(selection.customprefix_odt_set_spec_extra).toBeUndefined();
    expect(selection.customprefix_odt_set_plan).toBe(false);
  });
});
