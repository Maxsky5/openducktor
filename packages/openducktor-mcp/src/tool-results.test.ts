import { describe, expect, test } from "bun:test";

import {
  OdtToolError,
  toErrorMessage,
  toTaskAssetsToolResult,
  toTaskArtifactsToolResult,
  toToolError,
} from "./tool-results";

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
            message:
              "workspaceId is fixed by the startup workspace and is not allowed in tool input.",
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
            message:
              "workspaceId is fixed by the startup workspace and is not allowed in tool input.",
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

describe("task artifact results", () => {
  const artifact = {
    code: "output",
    taskId: "task-1",
    name: "Output",
    revision: 1,
    updatedAt: "2026-10-22T10:00:00Z",
    classification: "free" as const,
    fileName: "output.txt",
    mediaType: "text/plain",
    byteSize: 0,
  };
  const chunk = (bytes: Buffer, mediaType = "text/plain") => ({
    artifact: { ...artifact, mediaType, byteSize: bytes.length },
    version: "version-1",
    dataBase64: bytes.toString("base64"),
    byteOffset: 0,
    nextByteOffset: null,
    totalBytes: bytes.length,
  });

  test.each([
    { mediaType: "text/plain", text: "" },
    { mediaType: "text/plain", text: "\ufefffirst\r\nlast\n" },
    { mediaType: "application/json", text: "é😀\u0000" },
  ])("preserves exact $mediaType text $text in one JSON result", ({ mediaType, text }) => {
    const result = toTaskArtifactsToolResult({
      artifacts: [chunk(Buffer.from(text), mediaType)],
    });
    expect(result.content).toHaveLength(1);
    expect(result.structuredContent?.artifacts).toEqual([
      {
        artifact: { ...artifact, mediaType, byteSize: Buffer.byteLength(text) },
        version: "version-1",
        byteOffset: 0,
        nextByteOffset: null,
        totalBytes: Buffer.byteLength(text),
        content: text,
      },
    ]);
    expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(result.structuredContent);
    expect(result.content[0]?.text).toBe(JSON.stringify(result.structuredContent, null, 2));
  });

  test("returns exact SVG source and original bytes without a raster preview", () => {
    const text = '\ufeff<svg xmlns="http://www.w3.org/2000/svg">\r\n<text>é😀</text>\r\n</svg>\n';
    const original = chunk(Buffer.from(text), "image/svg+xml");
    const result = toTaskArtifactsToolResult({ artifacts: [original] });
    const { dataBase64, ...metadata } = original;
    expect(result.structuredContent?.artifacts).toEqual([{ ...metadata, content: text }]);
    expect(result.content.slice(1)).toEqual([
      {
        type: "resource",
        resource: {
          uri: expect.stringContaining("version=version-1&offset=0&length="),
          mimeType: "image/svg+xml",
          blob: dataBase64,
        },
      },
    ]);
  });

  test.each(["image/png", "image/jpeg", "image/webp", "image/gif"])(
    "returns complete %s bytes as one native image without codec work",
    (mediaType) => {
      // Opaque bytes must pass through, even when an image decoder would reject them.
      const original = chunk(Buffer.from([0, 1, 0xfe, 0xff]), mediaType);
      const result = toTaskArtifactsToolResult({ artifacts: [original] });
      expect(result.content.slice(1)).toEqual([
        { type: "image", mimeType: mediaType, data: original.dataBase64 },
      ]);
      expect(JSON.stringify(result).split(original.dataBase64)).toHaveLength(2);
    },
  );

  test.each([
    { byteOffset: 0, nextByteOffset: 4, totalBytes: 8 },
    { byteOffset: 4, nextByteOffset: null, totalBytes: 8 },
  ])("returns partial raster reads as bytes at offset $byteOffset", (range) => {
    const original = {
      ...chunk(Buffer.from([0, 1, 0xfe, 0xff]), "image/png"),
      ...range,
    };
    original.artifact.byteSize = range.totalBytes;
    const result = toTaskArtifactsToolResult({ artifacts: [original] });
    expect(result.content.slice(1)).toEqual([
      {
        type: "resource",
        resource: {
          uri: expect.stringContaining(`offset=${range.byteOffset}&length=4`),
          mimeType: "image/png",
          blob: original.dataBase64,
        },
      },
    ]);
  });

  test("returns named spec and plan text in the selected order with chunk metadata", () => {
    const artifacts = [
      { code: "plan" as const, name: "Implementation plan", text: "# Plan\r\n1. Build\r\n" },
      { code: "spec" as const, name: "Requirements", text: "# Spec\n\nShip é😀.\n" },
    ].map(({ code, name, text }) => ({
      ...chunk(Buffer.from(text), "text/markdown"),
      artifact: {
        code,
        name,
        taskId: "task-1",
        classification: "workflow" as const,
        revision: 1,
        updatedAt: null,
        mediaType: "text/markdown" as const,
      },
      version: `version-${code}`,
    }));
    const result = toTaskArtifactsToolResult({ artifacts });
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual({
      artifacts: [
        {
          artifact: artifacts[0]?.artifact,
          version: "version-plan",
          byteOffset: 0,
          nextByteOffset: null,
          totalBytes: Buffer.byteLength("# Plan\r\n1. Build\r\n"),
          content: "# Plan\r\n1. Build\r\n",
        },
        {
          artifact: artifacts[1]?.artifact,
          version: "version-spec",
          byteOffset: 0,
          nextByteOffset: null,
          totalBytes: Buffer.byteLength("# Spec\n\nShip é😀.\n"),
          content: "# Spec\n\nShip é😀.\n",
        },
      ],
    });
    expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(result.structuredContent);
  });

  test.each(["text/plain", "image/svg+xml"])(
    "returns invalid %s UTF-8 bytes with a decoding failure",
    (mediaType) => {
      const result = toTaskArtifactsToolResult({
        artifacts: [chunk(Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0x28]), mediaType)],
      });
      expect(result.content[1]).toMatchObject({
        type: "text",
        text: expect.stringContaining("Cannot decode artifact output"),
      });
      expect(result.content[2]).toMatchObject({
        type: "resource",
        resource: {
          blob: "77u/wyg=",
          mimeType: mediaType,
          uri: expect.stringContaining("version=version-1&offset=0&length=5"),
        },
      });
      expect(result.structuredContent?.artifacts).toEqual([
        {
          artifact: { ...artifact, mediaType, byteSize: 5 },
          version: "version-1",
          byteOffset: 0,
          nextByteOffset: null,
          totalBytes: 5,
        },
      ]);
    },
  );

  test("blob resource URIs use stable codes and omit display names", () => {
    const original = chunk(Buffer.from([0xff]));
    const result = toTaskArtifactsToolResult({
      artifacts: [
        {
          ...original,
          artifact: {
            taskId: "task-1",
            name: "Spec / notes",
            classification: "workflow",
            code: "spec",
            revision: 1,
            updatedAt: null,
            mediaType: "text/markdown",
          },
        },
        { ...original, artifact: { ...original.artifact, name: "Spec / notes" } },
      ],
    });
    expect(result.content.filter((block) => block.type === "resource")).toEqual([
      {
        type: "resource",
        resource: {
          uri: "odt-artifact:///tasks/task-1/artifacts/workflow/spec?version=version-1&offset=0&length=1",
          mimeType: "text/markdown",
          blob: "/w==",
        },
      },
      {
        type: "resource",
        resource: {
          uri: "odt-artifact:///tasks/task-1/artifacts/free/output?version=version-1&offset=0&length=1",
          mimeType: "text/plain",
          blob: "/w==",
        },
      },
    ]);
  });

  test("bounds the full JSON-RPC response for escaped text and request IDs", () => {
    const payload = chunk(Buffer.alloc(512 * 1024));
    const result = toTaskArtifactsToolResult({ artifacts: [payload] }, "request-1");
    expect(
      Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: "request-1", result })) + 1,
    ).toBeLessThan(10 * 1024 * 1024);
    expect(() =>
      toTaskArtifactsToolResult({ artifacts: [chunk(Buffer.alloc(1024 * 1024))] }),
    ).toThrow("10 MiB MCP response limit");
    expect(() =>
      toTaskArtifactsToolResult({ artifacts: [payload] }, "x".repeat(4 * 1024 * 1024)),
    ).toThrow("10 MiB MCP response limit");
  });

  test("bounds aggregate native image responses without changing their bytes", () => {
    const original = chunk(Buffer.alloc(1024 * 1024, 0xff), "image/png");
    const result = toTaskArtifactsToolResult({ artifacts: [original] });
    expect(result.content.slice(1)).toEqual([
      { type: "image", mimeType: "image/png", data: original.dataBase64 },
    ]);
    expect(() =>
      toTaskArtifactsToolResult({ artifacts: Array.from({ length: 8 }, () => original) }),
    ).toThrow("Select fewer artifacts or reduce maxBytes");
  });
});
