import { describe, expect, test } from "bun:test";
import {
  codexSessionRef,
  codexStartSessionInput,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";

const tokenUsageNotification = (totalTokens: number, threadId = "thread/start-runtime-live") => ({
  method: "thread/tokenUsage/updated",
  params: {
    threadId,
    turnId: "turn-1",
    tokenUsage: {
      total: { totalTokens },
      last: { totalTokens },
      modelContextWindow: 200_000,
    },
  },
});

describe("CodexAppServerAdapter context loading", () => {
  test("returns retained context without a Codex resume", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    runtimeStream.emitNotification(tokenUsageNotification(1_000));
    await flushCodexAdapterWork();

    await expect(adapter.loadSessionContextUsage(codexSessionRef())).resolves.toEqual({
      totalTokens: 1_000,
      contextWindow: 200_000,
    });
    expect(
      transports.get("runtime-live")?.calls.filter((call) => call.method === "thread/resume"),
    ).toEqual([]);
  });

  test("retains a recovered cold session even when its context usage is null", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter } = createHarness({ subscribeEvents: runtimeStream.subscribeEvents });

    await expect(
      adapter.loadSessionContextUsage(codexSessionRef("thread-idle")),
    ).resolves.toBeNull();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
        contextUsage: null,
      }),
    );
  });

  test("rehydrates a cold session when delayed usage is cached", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    await adapter.releaseSession(codexSessionRef());
    runtimeStream.emitNotification(tokenUsageNotification(3_000));
    await flushCodexAdapterWork();

    await expect(adapter.loadSessionContextUsage(codexSessionRef())).resolves.toEqual({
      totalTokens: 3_000,
      contextWindow: 200_000,
    });
    expect(
      transports.get("runtime-live")?.calls.filter((call) => call.method === "thread/resume"),
    ).toHaveLength(1);
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread/start-runtime-live" }),
        contextUsage: { totalTokens: 3_000, contextWindow: 200_000 },
      }),
    );
  });

  test("uses stream usage that arrives while resume is outstanding", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
    const resumeStarted = createDeferred<void>();
    const resume = createDeferred<void>();
    if (transport && request) {
      transport.request = async <Response>(input): Promise<Response> => {
        if (input.method === "thread/resume") {
          resumeStarted.resolve(undefined);
          await resume.promise;
        }
        return request<Response>(input);
      };
    }

    const loading = adapter.loadSessionContextUsage(codexSessionRef());
    await resumeStarted.promise;
    runtimeStream.emitNotification(tokenUsageNotification(2_000));
    await flushCodexAdapterWork();
    resume.resolve(undefined);

    await expect(loading).resolves.toEqual({ totalTokens: 2_000, contextWindow: 200_000 });
  });

  test("projects usage that arrives after a successful null resume", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter } = createHarness({ subscribeEvents: runtimeStream.subscribeEvents });
    await adapter.startSession(codexStartSessionInput());

    await expect(adapter.loadSessionContextUsage(codexSessionRef())).resolves.toBeNull();
    runtimeStream.emitNotification(tokenUsageNotification(2_100));
    await flushCodexAdapterWork();

    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.contextUsage).toEqual({
      totalTokens: 2_100,
      contextWindow: 200_000,
    });
  });

  test("keeps the stream through session release and stops it on runtime release", async () => {
    const unsubscribedRuntimeIds: string[] = [];
    const { adapter } = createHarness({
      subscribeEvents: (runtimeId) => () => {
        unsubscribedRuntimeIds.push(runtimeId);
      },
    });
    await adapter.startSession(codexStartSessionInput());

    await adapter.releaseSession(codexSessionRef());
    expect(unsubscribedRuntimeIds).toEqual([]);
    adapter.releaseRuntime("runtime-live");
    expect(unsubscribedRuntimeIds).toEqual(["runtime-live"]);
  });
});
