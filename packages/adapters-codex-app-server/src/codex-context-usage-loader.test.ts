import { describe, expect, test } from "bun:test";
import {
  codexSessionRef,
  codexStartSessionInput,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
  makeRuntimeSummary,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";

const blockResume = (transport: RecordingTransport) => {
  const request = transport.request.bind(transport);
  const started = createDeferred<void>();
  const resume = createDeferred<void>();
  const completed = createDeferred<void>();
  transport.request = async <Response>(input): Promise<Response> => {
    if (input.method === "thread/resume") {
      started.resolve(undefined);
      await resume.promise;
      const response = await request<Response>(input);
      completed.resolve(undefined);
      return response;
    }
    return request<Response>(input);
  };
  return { started, resume, completed };
};

describe("CodexContextUsageLoader", () => {
  test("cancels cold loads for released sessions and runtimes without late retention", async () => {
    for (const release of ["session", "runtime"] as const) {
      const runtimeStream = createRuntimeStreamSubscription();
      const transport = new RecordingTransport("runtime-live", false);
      const { adapter } = createHarness({
        subscribeEvents: runtimeStream.subscribeEvents,
        transportFactory: () => transport,
      });
      const blocked = blockResume(transport);
      const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
      await blocked.started.promise;
      if (release === "session") {
        await adapter.releaseSession(codexSessionRef("thread-idle"));
      } else {
        adapter.releaseRuntime("runtime-live");
      }

      await expect(loading).rejects.toThrow("was released while loading context usage");
      blocked.resume.resolve(undefined);
      await blocked.completed.promise;
      await flushCodexAdapterWork();
      expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    }
  });

  test("rejects before runtime binding and during preparation", async () => {
    const runtime = createDeferred<ReturnType<typeof makeRuntimeSummary>>();
    const { adapter, transports } = createHarness({
      repoRuntimeResolver: { requireRepoRuntime: () => runtime.promise },
    });
    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    await adapter.releaseSession(codexSessionRef("thread-idle"));
    await expect(loading).rejects.toThrow("was released while loading context usage");
    runtime.resolve(makeRuntimeSummary("runtime-live"));
    expect(transports.get("runtime-live")?.calls ?? []).toEqual([]);

    const preparationStarted = createDeferred<void>();
    const preparation = createDeferred<() => void>();
    const prepared = createHarness({
      subscribeEvents: () => {
        preparationStarted.resolve(undefined);
        return preparation.promise;
      },
    });
    const preparationLoad = prepared.adapter.loadSessionContextUsage(
      codexSessionRef("thread-idle"),
    );
    await preparationStarted.promise;
    prepared.adapter.releaseRuntime("runtime-live");
    await expect(preparationLoad).rejects.toThrow("was released while loading context usage");
    preparation.resolve(() => {});
    expect(prepared.transports.get("runtime-live")?.calls ?? []).toEqual([]);
  });

  test("treats runtime release before binding as terminal", async () => {
    const runtime = createDeferred<ReturnType<typeof makeRuntimeSummary>>();
    const { adapter, transports } = createHarness({
      repoRuntimeResolver: { requireRepoRuntime: () => runtime.promise },
    });
    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    adapter.releaseRuntime("runtime-live");
    runtime.resolve(makeRuntimeSummary("runtime-live"));

    await expect(loading).rejects.toThrow("was released while loading context usage");
    expect(transports.get("runtime-live")?.calls ?? []).toEqual([]);
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("cancels retained and routed-child live loads on stop or release", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    if (!transport) {
      throw new Error("Expected Codex transport.");
    }
    const stopped = blockResume(transport);
    const liveLoading = adapter.loadLiveSessionContextUsage({
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
    });
    await stopped.started.promise;
    await adapter.stopSession(codexSessionRef());
    await expect(liveLoading).rejects.toThrow("was released while loading context usage");
    stopped.resume.resolve(undefined);
    await stopped.completed.promise;
    await flushCodexAdapterWork();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);

    await adapter.startSession(codexStartSessionInput());
    const state = adapter as unknown as { subagents: CodexSubagentLinkState };
    state.subagents.upsertLink({
      runtimeId: "runtime-live",
      parentThreadId: "thread/start-runtime-live",
      childThreadId: "child-thread",
      itemId: "child-thread",
      status: "running",
    });
    const child = blockResume(transport);
    const childLoading = adapter.loadLiveSessionContextUsage({
      runtimeId: "runtime-live",
      externalSessionId: "child-thread",
    });
    await child.started.promise;
    await adapter.releaseSession({ ...codexSessionRef(), externalSessionId: "child-thread" });
    await expect(childLoading).rejects.toThrow("was released while loading context usage");
    child.resume.resolve(undefined);
    await child.completed.promise;
    await flushCodexAdapterWork();
    expect(
      adapter
        .listLiveSessionSnapshots("runtime-live")
        .find((snapshot) => snapshot.ref.externalSessionId === "child-thread")?.contextUsage,
    ).toBeNull();
  });

  test("cancels routed-child loads when the parent is released or stopped", async () => {
    for (const action of ["release", "stop"] as const) {
      const runtimeStream = createRuntimeStreamSubscription();
      const { adapter, transports } = createHarness({
        subscribeEvents: runtimeStream.subscribeEvents,
      });
      await adapter.startSession(codexStartSessionInput());
      const transport = transports.get("runtime-live");
      if (!transport) {
        throw new Error("Expected Codex transport.");
      }
      const state = adapter as unknown as { subagents: CodexSubagentLinkState };
      state.subagents.upsertLink({
        runtimeId: "runtime-live",
        parentThreadId: "thread/start-runtime-live",
        childThreadId: "child-thread",
        itemId: "child-thread",
        status: "running",
      });
      const child = blockResume(transport);
      const loading = adapter.loadLiveSessionContextUsage({
        runtimeId: "runtime-live",
        externalSessionId: "child-thread",
      });
      await child.started.promise;
      if (action === "release") {
        await adapter.releaseSession(codexSessionRef());
      } else {
        await adapter.stopSession(codexSessionRef());
      }

      await expect(loading).rejects.toThrow("was released while loading context usage");
      child.resume.resolve(undefined);
      await child.completed.promise;
      await flushCodexAdapterWork();
      expect(
        adapter
          .listLiveSessionSnapshots("runtime-live")
          .find((snapshot) => snapshot.ref.externalSessionId === "child-thread"),
      ).toBeUndefined();
    }
  });

  test("loads uncached grandchild context through retained root ownership", async () => {
    const { adapter, transports } = createHarness();
    await adapter.startSession(codexStartSessionInput());
    const state = adapter as unknown as { subagents: CodexSubagentLinkState };
    state.subagents.upsertLink({
      runtimeId: "runtime-live",
      parentThreadId: "thread/start-runtime-live",
      childThreadId: "child-thread",
      itemId: "child-thread",
      status: "running",
    });
    state.subagents.upsertLink({
      runtimeId: "runtime-live",
      parentThreadId: "child-thread",
      childThreadId: "grandchild-thread",
      itemId: "grandchild-thread",
      status: "running",
    });

    await expect(
      adapter.loadLiveSessionContextUsage({
        runtimeId: "runtime-live",
        externalSessionId: "grandchild-thread",
      }),
    ).resolves.toBeNull();

    expect(transports.get("runtime-live")?.calls).toContainEqual(
      expect.objectContaining({
        method: "thread/resume",
        params: expect.objectContaining({
          threadId: "grandchild-thread",
          cwd: "/repo",
          excludeTurns: false,
        }),
      }),
    );
  });

  test("rejects cross-runtime and cyclic live context routes before resuming", async () => {
    for (const kind of ["cross-runtime", "cycle"] as const) {
      const { adapter, transports } = createHarness();
      const state = adapter as unknown as { subagents: CodexSubagentLinkState };
      if (kind === "cross-runtime") {
        state.subagents.upsertLink({
          runtimeId: "runtime-other",
          parentThreadId: "root-thread",
          childThreadId: "child-thread",
          itemId: "child-thread",
          status: "running",
        });
        state.subagents.upsertLink({
          runtimeId: "runtime-live",
          parentThreadId: "child-thread",
          childThreadId: "grandchild-thread",
          itemId: "grandchild-thread",
          status: "running",
        });
      } else {
        state.subagents.upsertLink({
          runtimeId: "runtime-live",
          parentThreadId: "cycle-child",
          childThreadId: "cycle-grandchild",
          itemId: "cycle-grandchild",
          status: "running",
        });
        state.subagents.upsertLink({
          runtimeId: "runtime-live",
          parentThreadId: "cycle-grandchild",
          childThreadId: "cycle-child",
          itemId: "cycle-child",
          status: "running",
        });
      }
      const externalSessionId = kind === "cross-runtime" ? "grandchild-thread" : "cycle-grandchild";

      await expect(
        adapter.loadLiveSessionContextUsage({ runtimeId: "runtime-live", externalSessionId }),
      ).rejects.toThrow("Cannot load Codex session context usage");
      expect(transports.get("runtime-live")?.calls ?? []).not.toContainEqual(
        expect.objectContaining({ method: "thread/resume" }),
      );
    }
  });
});
