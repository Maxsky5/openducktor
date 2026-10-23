import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  OdtBrowserCaller,
  DeleteTaskArtifactInput,
  ReadTaskArtifactsResult,
  SetTaskArtifactInput,
} from "@openducktor/contracts";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createTransport,
  connectClientWithEnv,
  expectToolError,
  readToolInputProperties,
  startMockBridge,
  taskReadPayload,
  useMcpServerTestLifecycle,
} from "./test-support/mcp-server-harness";

useMcpServerTestLifecycle();

test("MCP discovers task artifacts and reads their JSON content in two calls", async () => {
  const bridge = await startMockBridge();
  const client = new Client({ name: "artifact-test", version: "1" });
  try {
    await client.connect(await createTransport(bridge.url, { workspaceId: "repo" }));
    const tools = await client.listTools();
    expect(
      tools.tools.filter((tool) => tool.name.includes("task_artifact")).map((tool) => tool.name),
    ).toEqual(["odt_read_task_artifacts", "odt_set_task_artifact", "odt_delete_task_artifact"]);
    for (const name of ["odt_set_spec", "odt_set_plan", "odt_qa_approved", "odt_qa_rejected"]) {
      expect(tools.tools.map((tool) => tool.name)).not.toContain(name);
    }
    const readTool = tools.tools.find((tool) => tool.name === "odt_read_task_artifacts");
    expect(readTool?.outputSchema).toMatchObject({
      properties: {
        artifacts: { items: { properties: { content: { type: "string" } } } },
      },
    });
    expect(readToolInputProperties(tools, "odt_read_task_artifacts")).toMatchObject({
      codes: expect.any(Object),
    });
    expect(readToolInputProperties(tools, "odt_read_task_artifacts")).not.toHaveProperty(
      "artifactIds",
    );
    expect(readToolInputProperties(tools, "odt_set_task_artifact")).toMatchObject({
      code: expect.any(Object),
      name: expect.any(Object),
      verdict: expect.any(Object),
      content: expect.objectContaining({ type: "string" }),
      dataBase64: expect.objectContaining({ type: "string" }),
    });
    expect(readToolInputProperties(tools, "odt_set_task_artifact")).not.toHaveProperty("caller");
    expect(readToolInputProperties(tools, "odt_set_task_artifact")).not.toHaveProperty("role");
    expect(readToolInputProperties(tools, "odt_delete_task_artifact")).toHaveProperty("code");
    expect(readToolInputProperties(tools, "odt_delete_task_artifact")).not.toHaveProperty("name");
    expect(readToolInputProperties(tools, "odt_delete_task_artifact")).not.toHaveProperty("caller");
    expect(readToolInputProperties(tools, "odt_delete_task_artifact")).not.toHaveProperty("role");
    for (const name of [
      "odt_read_task",
      "odt_read_task_artifacts",
      "odt_set_task_artifact",
      "odt_delete_task_artifact",
    ]) {
      const tool = tools.tools.find((entry) => entry.name === name);
      expect(JSON.stringify(tool?.inputSchema)).not.toContain('"artifactId"');
      expect(JSON.stringify(tool?.inputSchema)).not.toContain('"workflowKinds"');
      expect(JSON.stringify(tool?.inputSchema)).not.toContain('"artifactNames"');
      expect(JSON.stringify(tool?.inputSchema)).not.toContain('"newName"');
      expect(JSON.stringify(tool?.outputSchema)).not.toContain('"artifactId"');
      expect(JSON.stringify(tool?.outputSchema)).not.toContain('"workflowKind"');
    }
    const metadata = await client.callTool({
      name: "odt_read_task",
      arguments: { taskId: "task-1" },
    });
    expect(metadata.isError).not.toBe(true);
    expect(metadata.content).toHaveLength(1);
    expect(metadata.structuredContent).toEqual(taskReadPayload);
    const result = await client.callTool({
      name: "odt_read_task_artifacts",
      arguments: { taskId: "task-1", codes: ["spec", "notes"] },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.structuredContent).toMatchObject({
      artifacts: [
        { artifact: { code: "spec" }, nextByteOffset: null, content: "# Spec\n" },
        {
          artifact: { code: "notes", name: "Notes" },
          version: "version-1",
          totalBytes: 3,
          nextByteOffset: null,
          content: "\ufeff",
        },
      ],
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify(result.structuredContent, null, 2),
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain('"artifactId"');
    expect(
      bridge.requests.filter((request) =>
        ["/invoke/odt_read_task", "/invoke/odt_read_task_artifacts"].includes(request.url),
      ),
    ).toHaveLength(2);
  } finally {
    await client.close();
  }
});

test("MCP rejects artifact reads without codes and removed artifact selectors", async () => {
  const bridge = await startMockBridge();
  const client = new Client({ name: "artifact-selection-test", version: "1" });
  try {
    await client.connect(await createTransport(bridge.url, { workspaceId: "repo" }));
    for (const arguments_ of [
      { taskId: "task-1" },
      { taskId: "task-1", artifactIds: ["free-1"] },
      { taskId: "task-1", codes: ["notes"], artifactIds: ["free-1"] },
      { taskId: "task-1", codes: ["notes"], artifactNames: ["Notes"] },
      { taskId: "task-1", codes: ["spec"], workflowKinds: ["spec"] },
    ]) {
      const result = await client.callTool({
        name: "odt_read_task_artifacts",
        arguments: arguments_,
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }
    for (const name of ["odt_set_task_artifact", "odt_delete_task_artifact"]) {
      const result = await client.callTool({
        name,
        arguments: { taskId: "task-1", code: "notes", artifactId: "free-1" },
      });
      expect(result.isError).toBe(true);
    }
    const renamed = await client.callTool({
      name: "odt_set_task_artifact",
      arguments: { taskId: "task-1", code: "notes", name: "Updated", newName: "Legacy" },
    });
    expect(renamed.isError).toBe(true);
    expect(bridge.requests.filter((request) => request.url.includes("task_artifact"))).toHaveLength(
      0,
    );
  } finally {
    await client.close();
  }
});

test("MCP rejects invalid workflow artifact writes and workflow deletion before the bridge", async () => {
  const bridge = await startMockBridge();
  const client = new Client({ name: "artifact-reserved-code-test", version: "1" });
  try {
    await client.connect(await createTransport(bridge.url, { workspaceId: "repo" }));
    for (const code of ["spec", "plan", "qaReport"]) {
      const saved = await client.callTool({
        name: "odt_set_task_artifact",
        arguments: {
          taskId: "task-1",
          code,
          name: "Notes",
          fileName: "notes.txt",
          mediaType: "text/plain",
          content: "Notes",
        },
      });
      const deleted = await client.callTool({
        name: "odt_delete_task_artifact",
        arguments: { taskId: "task-1", code },
      });
      expect(saved.isError).toBe(true);
      expect(deleted.isError).toBe(true);
    }
    expect(bridge.requests.filter((request) => request.url.includes("task_artifact"))).toHaveLength(
      0,
    );
  } finally {
    await client.close();
  }
});

test("MCP rejects conflicting or nested artifact content before the bridge", async () => {
  const bridge = await startMockBridge();
  const client = new Client({ name: "artifact-content-shape-test", version: "1" });
  try {
    await client.connect(await createTransport(bridge.url, { workspaceId: "repo" }));
    for (const fields of [
      { content: "Text", dataBase64: "AA==" },
      { content: { encoding: "utf8", text: "Text" } },
      { content: { encoding: "base64", data: "AA==" } },
      { content: "Text", encoding: "utf8" },
    ]) {
      const result = await client.callTool({
        name: "odt_set_task_artifact",
        arguments: {
          taskId: "task-1",
          code: "notes",
          name: "Notes",
          fileName: "notes.txt",
          mediaType: "text/plain",
          ...fields,
        },
      });
      expect(result.isError).toBe(true);
    }
    expect(
      bridge.requests.filter((request) => request.url === "/invoke/odt_set_task_artifact"),
    ).toHaveLength(0);
  } finally {
    await client.close();
  }
});

test("MCP preserves binary image bytes and returns their saved metadata", async () => {
  const bridge = await startMockBridge();
  const client = new Client({ name: "artifact-binary-test", version: "1" });
  const input = {
    taskId: "task-1",
    code: "preview",
    name: "Preview",
    fileName: "preview.png",
    mediaType: "image/png",
    dataBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY5kAAAAASUVORK5CYII=",
  };
  try {
    await client.connect(await createTransport(bridge.url, { workspaceId: "repo" }));
    const result = await client.callTool({ name: "odt_set_task_artifact", arguments: input });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      artifact: {
        ...taskReadPayload.task.artifacts[1],
        code: "preview",
        name: "Preview",
        fileName: "preview.png",
        mediaType: "image/png",
        byteSize: 68,
      },
    });
    expect(
      bridge.requests.filter((request) => request.url === "/invoke/odt_set_task_artifact"),
    ).toEqual([{ url: "/invoke/odt_set_task_artifact", body: { ...input, workspaceId: "repo" } }]);
  } finally {
    await client.close();
  }
});

test.each([
  {
    runtime: "opencode",
    env: { ODT_RUNTIME_KIND: "opencode" },
    meta: { "ai.opencode/sessionID": "ses_child" },
    code: "spec",
    verdict: undefined,
    caller: { runtime: "opencode" as const, runtimeSessionId: "ses_child" },
  },
  {
    runtime: "codex",
    env: { ODT_RUNTIME_KIND: "codex" },
    meta: { threadId: "native-thread", sessionId: "unrelated-session" },
    code: "plan",
    verdict: undefined,
    caller: { runtime: "codex" as const, runtimeSessionId: "native-thread" },
  },
  {
    runtime: "claude",
    env: { ODT_RUNTIME_KIND: "claude", ODT_RUNTIME_SESSION_ID: "native-claude-session" },
    meta: { threadId: "unrelated-thread" },
    code: "qaReport",
    verdict: "approved" as const,
    caller: { runtime: "claude" as const, runtimeSessionId: "native-claude-session" },
  },
  {
    runtime: "external",
    env: {},
    meta: { threadId: "untrusted-thread" },
    code: "spec",
    verdict: undefined,
    caller: undefined,
  },
])("MCP normalizes content and forwards the $runtime artifact caller", async (testCase) => {
  const bridge = await startMockBridge();
  const client = await connectClientWithEnv(bridge.url, testCase.env);
  try {
    const input: SetTaskArtifactInput = {
      taskId: "task-1",
      code: testCase.code,
      content: "\ufeff# Workflow é\r\n",
    };
    const expectedBody: SetTaskArtifactInput & { caller?: OdtBrowserCaller } = {
      workspaceId: "repo",
      taskId: "task-1",
      code: testCase.code,
      dataBase64: "77u/IyBXb3JrZmxvdyDDqQ0K",
    };
    if (testCase.verdict) {
      input.verdict = testCase.verdict;
      expectedBody.verdict = testCase.verdict;
    }
    if (testCase.caller) {
      expectedBody.caller = testCase.caller;
    }
    const result = await client.callTool({
      name: "odt_set_task_artifact",
      arguments: input,
      _meta: testCase.meta,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      artifact: expect.objectContaining({
        code: testCase.code,
        taskId: "task-1",
        classification: "workflow",
        mediaType: "text/markdown",
        revision: 1,
      }),
    });
    if (testCase.verdict) {
      expect(result.structuredContent).toMatchObject({ artifact: { verdict: testCase.verdict } });
    }
    expect(
      bridge.requests.filter((request) => request.url === "/invoke/odt_set_task_artifact"),
    ).toEqual([
      {
        url: "/invoke/odt_set_task_artifact",
        body: expectedBody,
      },
    ]);
    const deleted = await client.callTool({
      name: "odt_delete_task_artifact",
      arguments: { taskId: "task-1", code: "notes" },
      _meta: testCase.meta,
    });
    expect(deleted.isError).not.toBe(true);
    const expectedDeleteBody: DeleteTaskArtifactInput & { caller?: OdtBrowserCaller } = {
      workspaceId: "repo",
      taskId: "task-1",
      code: "notes",
    };
    if (testCase.caller) expectedDeleteBody.caller = testCase.caller;
    expect(
      bridge.requests.filter((request) => request.url === "/invoke/odt_delete_task_artifact"),
    ).toEqual([
      {
        url: "/invoke/odt_delete_task_artifact",
        body: expectedDeleteBody,
      },
    ]);
  } finally {
    await client.close();
  }
});

test.each([
  { runtime: "codex", meta: { turnId: "turn-1" }, reason: "_meta.threadId" },
  { runtime: "opencode", meta: { sessionID: "model-session" }, reason: "ai.opencode/sessionID" },
])("MCP rejects a managed $runtime artifact write without a native caller", async (testCase) => {
  const bridge = await startMockBridge();
  const client = await connectClientWithEnv(bridge.url, { ODT_RUNTIME_KIND: testCase.runtime });
  try {
    for (const name of ["odt_set_task_artifact", "odt_delete_task_artifact"]) {
      const result = await client.callTool({
        name,
        arguments:
          name === "odt_set_task_artifact"
            ? { taskId: "task-1", code: "spec", content: "# Spec" }
            : { taskId: "task-1", code: "notes" },
        _meta: testCase.meta,
      });
      expect(expectToolError(result).message).toContain(testCase.reason);
    }
    expect(bridge.requests.filter((request) => request.url.includes("task_artifact"))).toHaveLength(
      0,
    );
  } finally {
    await client.close();
  }
});

test("MCP rejects caller and role from artifact tool arguments", async () => {
  const bridge = await startMockBridge();
  const client = await connectClientWithEnv(bridge.url, { ODT_RUNTIME_KIND: "codex" });
  try {
    for (const fields of [
      { caller: { runtime: "codex", runtimeSessionId: "model-session" } },
      { role: "qa" },
    ]) {
      for (const name of ["odt_set_task_artifact", "odt_delete_task_artifact"]) {
        const result = await client.callTool({
          name,
          arguments: {
            taskId: "task-1",
            ...(name === "odt_set_task_artifact"
              ? { code: "spec", content: "# Spec" }
              : { code: "notes" }),
            ...fields,
          },
          _meta: { threadId: "native-thread" },
        });
        expect(result.isError).toBe(true);
      }
    }
    expect(bridge.requests.filter((request) => request.url.includes("task_artifact"))).toHaveLength(
      0,
    );
  } finally {
    await client.close();
  }
});

const artifactChunk = (
  code: string,
  bytes: Buffer,
  mediaType: string,
  name = code,
): ReadTaskArtifactsResult["artifacts"][number] => ({
  artifact: {
    code,
    taskId: "task-1",
    name,
    classification: "free",
    revision: 1,
    updatedAt: null,
    fileName: code,
    mediaType,
    byteSize: bytes.byteLength,
  },
  version: `version-${code}`,
  dataBase64: bytes.toString("base64"),
  byteOffset: 0,
  nextByteOffset: null,
  totalBytes: bytes.byteLength,
});

test("MCP keeps artifact codes through rename, replacement, and deletion", async () => {
  const bridge = await startMockBridge();
  const client = new Client({ name: "artifact-set-test", version: "1" });
  try {
    await client.connect(await createTransport(bridge.url, { workspaceId: "repo" }));
    const renamed = await client.callTool({
      name: "odt_set_task_artifact",
      arguments: { taskId: "task-1", code: "notes", name: "Renamed" },
    });
    expect(renamed.isError).not.toBe(true);
    expect(renamed.structuredContent).toMatchObject({
      artifact: { ...taskReadPayload.task.artifacts[1], name: "Renamed" },
    });
    const replaced = await client.callTool({
      name: "odt_set_task_artifact",
      arguments: {
        taskId: "task-1",
        code: "notes",
        name: "Updated",
        fileName: "updated.txt",
        mediaType: "text/plain",
        content: "\ufeffUpdated\r\n",
      },
    });
    expect(replaced.isError).not.toBe(true);
    expect(replaced.structuredContent).toEqual({
      artifact: {
        ...taskReadPayload.task.artifacts[1],
        name: "Updated",
        fileName: "updated.txt",
        byteSize: 12,
      },
    });
    expect(JSON.stringify(replaced.structuredContent)).not.toContain('"artifactId"');
    expect(
      bridge.requests
        .filter((request) => request.url === "/invoke/odt_set_task_artifact")
        .map((request) => request.body),
    ).toEqual([
      { workspaceId: "repo", taskId: "task-1", code: "notes", name: "Renamed" },
      {
        workspaceId: "repo",
        taskId: "task-1",
        code: "notes",
        name: "Updated",
        fileName: "updated.txt",
        mediaType: "text/plain",
        dataBase64: "77u/VXBkYXRlZA0K",
      },
    ]);
    const deleted = await client.callTool({
      name: "odt_delete_task_artifact",
      arguments: { taskId: "task-1", code: "notes" },
    });
    expect(deleted.isError).not.toBe(true);
    expect(deleted.structuredContent).toEqual({
      code: "notes",
      cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 2 },
    });
    expect(bridge.requests).toContainEqual({
      url: "/invoke/odt_delete_task_artifact",
      body: { workspaceId: "repo", taskId: "task-1", code: "notes" },
    });
  } finally {
    await client.close();
  }
});

test("MCP reads mixed JSON text and native media with the same display name", async () => {
  const text = "\ufeffOrdered é😀\r\nlast\n";
  const textChunk = artifactChunk("text-1", Buffer.from(text), "text/plain", "Shared output");
  const imageChunk: ReadTaskArtifactsResult["artifacts"][number] = {
    ...artifactChunk("image-1", Buffer.from([0, 1, 0xff]), "image/svg+xml", "Shared output"),
    imagePreview: {
      state: "ready",
      mediaType: "image/png",
      dataBase64: "BAU=",
      byteSize: 2,
      width: 1,
      height: 1,
    },
  };
  const invalidChunk = artifactChunk(
    "invalid-1",
    Buffer.from([0xc3, 0x28]),
    "text/plain",
    "Shared output",
  );
  const bridge = await startMockBridge({
    artifactReadResult: { artifacts: [textChunk, imageChunk, invalidChunk] },
  });
  const client = new Client({ name: "artifact-batch-test", version: "1" });
  try {
    await client.connect(await createTransport(bridge.url, { workspaceId: "repo" }));
    const result = await client.callTool({
      name: "odt_read_task_artifacts",
      arguments: { taskId: "task-1", codes: ["text-1", "image-1", "invalid-1"] },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content.slice(1)).toEqual([
      {
        type: "resource",
        resource: {
          uri: expect.stringContaining(
            "/artifacts/free/image-1?version=version-image-1&offset=0&length=3",
          ),
          mimeType: "image/svg+xml",
          blob: "AAH/",
        },
      },
      { type: "image", mimeType: "image/png", data: "BAU=" },
      { type: "text", text: expect.stringContaining("Cannot decode artifact invalid-1 as UTF-8") },
      {
        type: "resource",
        resource: {
          uri: expect.stringContaining(
            "/artifacts/free/invalid-1?version=version-invalid-1&offset=0&length=2",
          ),
          mimeType: "text/plain",
          blob: "wyg=",
        },
      },
    ]);
    const { dataBase64: _textData, ...textMetadata } = textChunk;
    const { dataBase64: _imageData, imagePreview: _preview, ...imageMetadata } = imageChunk;
    const { dataBase64: _invalidData, ...invalidMetadata } = invalidChunk;
    expect(result.structuredContent).toEqual({
      artifacts: [{ ...textMetadata, content: text }, imageMetadata, invalidMetadata],
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify(result.structuredContent, null, 2),
    });
    for (const body of ["AAH/", "BAU=", "wyg="]) {
      expect(JSON.stringify(result).split(body)).toHaveLength(2);
    }
    expect(
      bridge.requests.find((request) => request.url === "/invoke/odt_read_task_artifacts")?.body,
    ).toEqual({
      workspaceId: "repo",
      taskId: "task-1",
      codes: ["text-1", "image-1", "invalid-1"],
    });
  } finally {
    await client.close();
  }
});

test("MCP rejects an aggregate artifact response above 10 MiB without a partial body", async () => {
  const bridge = await startMockBridge({
    artifactReadResult: {
      artifacts: ["first", "second"].map((id) =>
        artifactChunk(id, Buffer.alloc(1024 * 1024), "text/plain"),
      ),
    },
  });
  const client = new Client({ name: "artifact-batch-limit-test", version: "1" });
  try {
    await client.connect(await createTransport(bridge.url, { workspaceId: "repo" }));
    const result = await client.callTool({
      name: "odt_read_task_artifacts",
      arguments: { taskId: "task-1", codes: ["first", "second"], maxBytes: 1024 * 1024 },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("10 MiB MCP response limit") },
    ]);
  } finally {
    await client.close();
  }
});

test("stdio accepts a fully escaped 10 MiB artifact and encodes the bridge request once", async () => {
  const bridge = await startMockBridge();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "run",
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "--host-url",
      bridge.url,
      "--workspace-id",
      "repo",
    ],
  });
  const client = new Client({ name: "artifact-stdio-test", version: "1" });
  try {
    await client.connect(transport);
    const input = {
      taskId: "task-1",
      code: "escaped-text",
      name: "Escaped text",
      fileName: "nul.txt",
      mediaType: "text/plain",
      content: "\u0000".repeat(10 * 1024 * 1024),
    };
    const result = await client.callTool({ name: "odt_set_task_artifact", arguments: input });
    if (result.isError) throw new Error(JSON.stringify(result.content).slice(0, 2000));
    expect(result.structuredContent).toEqual({
      artifact: {
        ...taskReadPayload.task.artifacts[1],
        code: "escaped-text",
        name: "Escaped text",
        fileName: "nul.txt",
        byteSize: 10 * 1024 * 1024,
      },
    });
    const saved = bridge.requests.find(
      (request) => request.url === "/invoke/odt_set_task_artifact",
    );
    const body = z.object({ dataBase64: z.string() }).parse(saved?.body);
    expect(Buffer.from(body.dataBase64, "base64").equals(Buffer.alloc(10 * 1024 * 1024))).toBe(
      true,
    );
    expect(saved?.body).not.toHaveProperty("content");
    expect(Buffer.byteLength(JSON.stringify(saved?.body))).toBeLessThan(16 * 1024 * 1024);
    const invalid = await client.callTool({
      name: "odt_set_task_artifact",
      arguments: {
        taskId: "task-1",
        code: "escaped-text",
        fileName: "nul.txt",
        mediaType: "text/plain",
        dataBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
      },
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("artifact"),
    });
    expect(
      bridge.requests.filter((request) => request.url === "/invoke/odt_set_task_artifact"),
    ).toHaveLength(1);
  } finally {
    await client.close();
  }
}, 20_000);
