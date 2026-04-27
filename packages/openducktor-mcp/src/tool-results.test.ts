import { describe, expect, test } from "bun:test";

import { OdtToolError, toErrorMessage, toToolError } from "./tool-results";

describe("tool result error normalization", () => {
  test("keeps OdtToolError issues in the top-level structured error payload", () => {
    const result = toToolError(
      new OdtToolError("ODT_WORKSPACE_SCOPE_VIOLATION", "workspaceId is not allowed", {
        toolName: "odt_read_task",
        issues: [
          {
            path: ["workspaceId"],
            code: "forbidden_workspace_id",
            message: "workspaceId is not allowed in workflow-scoped tool calls.",
          },
        ],
      }),
    );

    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "ODT_WORKSPACE_SCOPE_VIOLATION",
        message: "workspaceId is not allowed",
        details: {
          toolName: "odt_read_task",
          issues: [
            {
              path: ["workspaceId"],
              code: "forbidden_workspace_id",
              message: "workspaceId is not allowed in workflow-scoped tool calls.",
            },
          ],
        },
        issues: [
          {
            path: ["workspaceId"],
            code: "forbidden_workspace_id",
            message: "workspaceId is not allowed in workflow-scoped tool calls.",
          },
        ],
      },
    });
  });

  test("preserves actionable messages for thrown primitive values", () => {
    expect(toErrorMessage(" bridge failed ")).toBe("bridge failed");
    expect(toErrorMessage(404)).toBe("404");
    expect(toErrorMessage(false)).toBe("false");
    expect(toErrorMessage({ message: "not an Error" })).toBe("Unknown error");
  });
});
