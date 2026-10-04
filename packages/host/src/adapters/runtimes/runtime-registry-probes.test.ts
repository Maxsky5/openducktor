import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { probeOpenCodeMcpStatus } from "./runtime-registry-probes";

type FetchRequest = (
  ...args: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>;

const fetchFixture = (request: FetchRequest): typeof globalThis.fetch =>
  Object.assign(request, { preconnect: () => {} });

const openCodeMcpProbeInput = {
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  workingDirectory: "/repo/worktree",
  serverName: "openducktor",
} as const;

describe("probeOpenCodeMcpStatus", () => {
  test("probes OpenCode MCP status and tool ids through the local runtime endpoint", async () => {
    const requests: Array<{
      method: string;
      pathname: string;
      directory: string | null;
    }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchFixture(
      mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request?.url ?? input.toString());
        const method = init?.method ?? request?.method ?? "GET";
        requests.push({
          method,
          pathname: url.pathname,
          directory: url.searchParams.get("directory"),
        });
        if (method === "GET" && url.pathname === "/mcp") {
          return Response.json({ openducktor: { status: "connected" } });
        }
        if (method === "GET" && url.pathname === "/experimental/tool/ids") {
          return Response.json(["odt_read_task", " odt_set_spec ", ""]);
        }
        return Response.json({ error: "not found" }, { status: 404 });
      }),
    );
    try {
      await expect(
        Effect.runPromise(probeOpenCodeMcpStatus(openCodeMcpProbeInput)),
      ).resolves.toEqual({
        supported: true,
        connected: true,
        serverStatus: "connected",
        toolIds: ["odt_read_task", "odt_set_spec"],
        detail: null,
        failureKind: null,
      });
      expect(requests).toEqual([
        {
          method: "GET",
          pathname: "/mcp",
          directory: "/repo/worktree",
        },
        {
          method: "GET",
          pathname: "/experimental/tool/ids",
          directory: "/repo/worktree",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reports OpenCode MCP fetch timeouts as reconnecting probe results", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchFixture(
      mock(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    try {
      await expect(
        Effect.runPromise(probeOpenCodeMcpStatus(openCodeMcpProbeInput)),
      ).resolves.toEqual({
        supported: true,
        connected: false,
        serverStatus: null,
        toolIds: [],
        detail: "The operation was aborted due to timeout",
        failureKind: "timeout",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
