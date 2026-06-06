import { describe, expect, test } from "bun:test";
import { createCodexAppServerClient } from "./app-server-client";
import type { CodexJsonRpcRequest, CodexJsonRpcTransport } from "./types";

describe("createCodexAppServerClient", () => {
  test("sends turn/interrupt requests", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request(request) {
        calls.push(request);
        return {};
      },
    };
    const client = createCodexAppServerClient(transport);
    await expect(client.turnInterrupt({ threadId: "thread-1", turnId: "turn-1" })).resolves.toEqual(
      {},
    );
    expect(calls).toEqual([
      {
        method: "turn/interrupt",
        params: { threadId: "thread-1", turnId: "turn-1" },
      },
    ]);
  });

  test("sends thread/name/set requests", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request(request) {
        calls.push(request);
        return {};
      },
    };
    const client = createCodexAppServerClient(transport);
    await expect(
      client.threadSetName({ threadId: "thread-1", name: "BUILD task-1" }),
    ).resolves.toEqual({});
    expect(calls).toEqual([
      {
        method: "thread/name/set",
        params: { threadId: "thread-1", name: "BUILD task-1" },
      },
    ]);
  });

  test("sends cwd-scoped skills/list requests", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request(request) {
        calls.push(request);
        return { data: [{ cwd: "/repo", skills: [] }], errors: [] };
      },
    };
    const client = createCodexAppServerClient(transport);

    await expect(client.skillsList({ cwd: "/repo", forceReload: false })).resolves.toEqual({
      data: [{ cwd: "/repo", skills: [] }],
      errors: [],
    });
    expect(calls).toEqual([
      {
        method: "skills/list",
        params: { cwd: "/repo", forceReload: false },
      },
    ]);
  });

  test("sends one-shot fuzzy file search requests unchanged", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const response = {
      files: [
        {
          root: "/repo",
          path: "src/main.ts",
          match_type: "file" as const,
          file_name: "main.ts",
          score: 8,
          indices: [0, 1],
        },
      ],
    };
    const transport: CodexJsonRpcTransport = {
      async request(request) {
        calls.push(request);
        return response;
      },
    };
    const client = createCodexAppServerClient(transport);
    const params = { query: "src", roots: ["/repo"], cancellationToken: null };

    await expect(client.fuzzyFileSearch(params)).resolves.toEqual(response);
    expect(calls).toEqual([
      {
        method: "fuzzyFileSearch",
        params,
      },
    ]);
  });
});
