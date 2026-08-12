import { describe, expect, test } from "bun:test";

import { OdtToolError, toErrorMessage, toTaskAssetsToolResult, toToolError } from "./tool-results";

describe("tool result error normalization", () => {
  test("keeps OdtToolError issues in the content error payload", () => {
    const result = toToolError(
      new OdtToolError({
        code: "ODT_WORKSPACE_SCOPE_VIOLATION",
        message: "workspaceId is not allowed",
        details: { toolName: "odt_read_task" },
        issues: [
          {
            path: ["workspaceId"],
            code: "forbidden_workspace_id",
            message: "workspaceId is not allowed in workflow-scoped tool calls.",
          },
        ],
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual({
      ok: false,
      error: {
        code: "ODT_WORKSPACE_SCOPE_VIOLATION",
        message: "workspaceId is not allowed",
        details: {
          toolName: "odt_read_task",
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

describe("task asset tool results", () => {
  test("returns ordered native image blocks without structured content", () => {
    const result = toTaskAssetsToolResult({
      assets: [
        {
          assetId: "28cb7c3d-5ec4-47e8-bffe-090223eae3b7",
          mediaType: "image/png",
          byteSize: 3,
          dataBase64: "AQID",
        },
        {
          assetId: "96d20c03-a470-47f6-9472-1a1d34cd23df",
          mediaType: "image/webp",
          byteSize: 2,
          dataBase64: "BAU=",
        },
      ],
    });

    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Task description asset 28cb7c3d-5ec4-47e8-bffe-090223eae3b7 (image/png, 3 bytes)",
      },
      { type: "image", data: "AQID", mimeType: "image/png" },
      {
        type: "text",
        text: "Task description asset 96d20c03-a470-47f6-9472-1a1d34cd23df (image/webp, 2 bytes)",
      },
      { type: "image", data: "BAU=", mimeType: "image/webp" },
    ]);
  });
});
