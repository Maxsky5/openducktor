import { describe, expect, test } from "bun:test";
import {
  createAdapterWithTransport,
  RecordingTransport,
  codexThreadFixture,
  defaultCodexEffectivePolicy,
} from "./codex-app-server-adapter.test-harness";

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
    const first = await adapter.listExternalSessions({ ...ref, signal });
    const second = await adapter.listExternalSessions({
      ...ref,
      signal,
      cursor: first.nextCursor!,
    });
    const archived = await adapter.listExternalSessions({
      ...ref,
      signal,
      cursor: second.nextCursor!,
    });
    expect([
      first.sessions[0]?.externalSessionId,
      second.sessions[0]?.externalSessionId,
      archived.sessions[0]?.externalSessionId,
    ]).toEqual(["first", "second", "archived"]);
    expect(first.sessions).toHaveLength(1);
    expect(archived.nextCursor).toBeNull();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    expect(transport.calls.every((call) => call.method === "thread/list")).toBe(true);
    expect(transport.calls[0]?.params).toMatchObject({
      modelProviders: [],
      limit: 100,
      archived: false,
    });
    await adapter.releaseRuntime("runtime-live");
  });

  test.each([
    { source: "cli" as const, parentThreadId: "parent", accepted: false },
    { source: { custom: "external" }, parentThreadId: null, accepted: true },
    { source: { custom: "external" }, parentThreadId: "parent", accepted: false },
    { source: { subAgent: "review" as const }, parentThreadId: null, accepted: false },
  ])(
    "uses parent and source metadata for catalog and exact import: %j",
    async ({ source, parentThreadId, accepted }) => {
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
            return { data: [thread], nextCursor: null, backwardsCursor: null };
          if (request.method === "thread/read") return { thread };
          return super.request(request);
        }
      }
      const transport = new SourceTransport("runtime-live", false);
      const adapter = createAdapterWithTransport(transport);
      const page = await adapter.listExternalSessions({
        ...ref,
        signal: new AbortController().signal,
      });
      expect(page.sessions.map((session) => session.externalSessionId)).toEqual(
        accepted ? [ref.externalSessionId] : [],
      );
      const preparation = adapter.prepareExternalSession({
        ...ref,
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
      });
      if (accepted) {
        const prepared = await preparation;
        await prepared.dispose();
      } else {
        await expect(preparation).rejects.toThrow("Subagent conversations cannot be imported");
        expect(transport.calls.some((call) => call.method === "thread/resume")).toBe(false);
      }
      expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
      await adapter.releaseRuntime("runtime-live");
    },
  );

  test("prepares an exact passive resume and admits only on commit", async () => {
    const transport = new RecordingTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);
    const prepared = await adapter.prepareExternalSession({
      ...ref,
      sessionScope: { kind: "repository" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    expect(transport.calls.map((call) => call.method)).toEqual(["thread/read", "thread/resume"]);
    expect(transport.calls[0]?.params).toEqual({ threadId: "native", includeTurns: false });
    expect(transport.calls[1]?.params).toEqual({ threadId: "native", excludeTurns: true });
    await prepared.commit();
    await prepared.dispose();
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
        const prepared = await adapter.prepareExternalSession(binding);
        await prepared.commit();
        await prepared.dispose();
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

  test("discard leaves a prepared native thread unowned without unloading it", async () => {
    const transport = new RecordingTransport("runtime-live", false);
    const adapter = createAdapterWithTransport(transport);
    const prepared = await adapter.prepareExternalSession({
      ...ref,
      sessionScope: { kind: "repository" },
      runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
    });
    await prepared.dispose();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    expect(
      transport.calls.some(
        (call) => call.method === "thread/unsubscribe" || call.method === "thread/archive",
      ),
    ).toBe(false);
    await adapter.releaseRuntime("runtime-live");
  });
});
