import type { CodexAppServerThread } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import {
  createAdapterWithTransport,
  RecordingTransport,
  codexThreadFixture,
  defaultCodexEffectivePolicy,
} from "./codex-app-server-adapter.test-harness";

// Codex 0.155 filters.rs has no source kind that matches SessionSource::Custom.
const matchesNativeSourceFilter = (
  source: CodexAppServerThread["source"],
  sourceKinds: readonly string[] | null | undefined,
): boolean => {
  const filters = sourceKinds?.length ? sourceKinds : ["cli", "vscode"];
  switch (source) {
    case "cli":
    case "vscode":
    case "exec":
    case "appServer":
    case "unknown":
      return filters.includes(source);
    default:
      if ("custom" in source) return false;
      return (
        filters.includes("subAgent") ||
        (source.subAgent === "review" && filters.includes("subAgentReview"))
      );
  }
};

const ref = {
  repoPath: "/repo",
  workingDirectory: "/repo",
  runtimeKind: "codex" as const,
  externalSessionId: "native",
};
describe("external Codex sessions", () => {
  test("lists metadata across active and archived pages without reading history or admitting sessions", async () => {
    class CatalogTransport extends RecordingTransport {
      async request(request: Parameters<RecordingTransport["request"]>[0]) {
        if (request.method !== "thread/list") return super.request(request);
        this.calls.push(request);
        const id = request.params.archived
          ? "archived"
          : request.params.cursor
            ? "second"
            : "first";
        return {
          data: [
            codexThreadFixture({ id, name: "Native", source: "cli", status: { type: "idle" } }),
            codexThreadFixture({
              id: "child",
              source: { subAgent: "review" },
              status: { type: "idle" },
            }),
          ],
          nextCursor: id === "first" ? "next" : null,
          backwardsCursor: null,
        };
      }
    }
    const transport = new CatalogTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);
    const signal = new AbortController().signal;
    const first = await adapter.listSessionMetadataPage({ ...ref, signal });
    expect(first.sessions.map((row) => row.externalSessionId)).toEqual([
      "archived",
      "first",
      "second",
    ]);
    expect(first.nextPageToken).toBeNull();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    expect(transport.calls.every((call) => call.method === "thread/list")).toBe(true);
    expect(transport.calls[0]?.params).toMatchObject({
      modelProviders: [],
      limit: 100,
      archived: false,
      sortKey: "updated_at",
      useStateDbOnly: true,
    });
    await adapter.releaseRuntime("runtime-live");
  });

  test("merges active and archived history by recency without draining either stream", async () => {
    class PagedTransport extends RecordingTransport {
      async request(request: Parameters<RecordingTransport["request"]>[0]) {
        if (request.method !== "thread/list") return super.request(request);
        this.calls.push(request);
        const start = Number(request.params.cursor ?? "0");
        return {
          data: Array.from({ length: 100 }, (_, index) => {
            const updatedAt = 2000 - (start + index) * 2 - (request.params.archived ? 1 : 0);
            return codexThreadFixture({
              id: String(updatedAt),
              updatedAt,
              source: "cli",
              status: { type: "idle" },
            });
          }),
          nextCursor: String(start + 100),
          backwardsCursor: null,
        };
      }
    }
    const transport = new PagedTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);
    const signal = new AbortController().signal;
    const first = await adapter.listSessionMetadataPage({ ...ref, signal });
    expect(first.sessions.map((row) => row.externalSessionId)).toEqual(
      Array.from({ length: 100 }, (_, index) => String(2000 - index)),
    );
    expect(transport.calls).toHaveLength(2);
    if (!first.nextPageToken) throw new Error("Expected another metadata page");
    const second = await adapter.listSessionMetadataPage({
      ...ref,
      signal,
      pageToken: first.nextPageToken,
    });
    expect(second.sessions.map((row) => row.externalSessionId)).toEqual(
      Array.from({ length: 100 }, (_, index) => String(1900 - index)),
    );
    // Refill the exhausted active stream to compare its head with the last archived row.
    expect(transport.calls).toHaveLength(3);
    await adapter.releaseRuntime("runtime-live");
  });

  test.each([
    { source: "cli" as const, parentThreadId: null, accepted: true, discoverable: true },
    { source: "cli" as const, parentThreadId: "parent", accepted: false, discoverable: false },
    { source: { custom: "external" }, parentThreadId: null, accepted: true, discoverable: false },
    {
      source: { custom: "external" },
      parentThreadId: "parent",
      accepted: false,
      discoverable: false,
    },
    {
      source: { subAgent: "review" as const },
      parentThreadId: null,
      accepted: false,
      discoverable: false,
    },
  ])(
    "uses parent and source metadata for catalog and exact import: %j",
    async ({ source, parentThreadId, accepted, discoverable }) => {
      class SourceTransport extends RecordingTransport {
        async request(request: Parameters<RecordingTransport["request"]>[0]) {
          const thread = codexThreadFixture({
            id: ref.externalSessionId,
            cwd: ref.workingDirectory,
            source,
            parentThreadId,
            status: { type: "idle" },
          });
          if (request.method === "thread/list")
            return {
              data: matchesNativeSourceFilter(source, request.params.sourceKinds) ? [thread] : [],
              nextCursor: null,
              backwardsCursor: null,
            };
          if (request.method === "thread/read") return { thread };
          return super.request(request);
        }
      }
      const transport = new SourceTransport("runtime-live", false);
      const adapter = createAdapterWithTransport(transport);
      const page = await adapter.listSessionMetadataPage({
        ...ref,
        signal: new AbortController().signal,
      });
      expect(page.sessions.map((session) => session.externalSessionId)).toEqual(
        discoverable ? [ref.externalSessionId] : [],
      );
      const preparation = adapter.openExistingSession({
        ...ref,
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      });
      if (accepted) {
        await preparation;
      } else {
        await expect(preparation).rejects.toThrow("Subagent conversations cannot be imported");
        expect(transport.calls.some((call) => call.method === "thread/resume")).toBe(false);
      }
      expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
      await adapter.releaseRuntime("runtime-live");
    },
  );

  test("opens the exact session and registers it only after import", async () => {
    const transport = new RecordingTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);
    const prepared = await adapter.openExistingSession({
      ...ref,
      sessionScope: { kind: "repository" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    expect(transport.calls.map((call) => call.method)).toEqual(["thread/read", "thread/resume"]);
    expect(transport.calls[0]?.params).toEqual({ threadId: "native", includeTurns: false });
    expect(transport.calls[1]?.params).toEqual({ threadId: "native", excludeTurns: true });
    await prepared.attach();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toHaveLength(1);
    await adapter.sendUserMessage({
      ...ref,
      sessionScope: { kind: "repository" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      parts: [{ kind: "text", text: "Hello" }],
    });
    const turn = transport.calls.find((call) => call.method === "turn/start");
    expect(turn?.params).not.toHaveProperty("sandboxPolicy");
    expect(turn?.params).not.toHaveProperty("approvalPolicy");
    expect(transport.calls.some((call) => call.method === "thread/name/set")).toBe(false);
    await adapter.releaseRuntime("runtime-live");
  });

  for (const cold of [true, false]) {
    test(`context loading preserves native settings for a ${cold ? "cold" : "live"} imported session`, async () => {
      const transport = new RecordingTransport("runtime-live", false);
      const adapter = createAdapterWithTransport(transport);
      const binding = {
        ...ref,
        sessionScope: { kind: "repository" as const },
        runtimePolicy: { kind: "codex" as const, policy: defaultCodexEffectivePolicy() },
      };
      if (!cold) {
        const prepared = await adapter.openExistingSession(binding);
        await prepared.attach();
      }
      transport.calls.length = 0;
      await adapter.loadSessionContextUsage(binding);
      expect(transport.calls.filter((call) => call.method === "thread/resume")).toEqual([
        { method: "thread/resume", params: { threadId: "native", excludeTurns: false } },
      ]);
      await adapter.sendUserMessage({
        ...binding,
        parts: [{ kind: "text", text: "Continue" }],
      });
      const turn = transport.calls.find((call) => call.method === "turn/start");
      expect(turn?.params).not.toHaveProperty("sandboxPolicy");
      expect(turn?.params).not.toHaveProperty("approvalPolicy");
      expect(transport.calls.some((call) => call.method === "thread/name/set")).toBe(false);
      await adapter.releaseRuntime("runtime-live");
    });
  }

  test("opening a source leaves its native thread unowned before registration", async () => {
    const transport = new RecordingTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);
    await adapter.openExistingSession({
      ...ref,
      sessionScope: { kind: "repository" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    expect(
      transport.calls.some(
        (call) => call.method === "thread/unsubscribe" || call.method === "thread/archive",
      ),
    ).toBe(false);
    await adapter.releaseRuntime("runtime-live");
  });
});
