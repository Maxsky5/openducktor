import { describe, expect, test } from "bun:test";
import {
  codexSessionRef,
  codexSessionRuntimeRef,
  codexStartSessionInput,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
  makeRuntimeSummary,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import { CodexContextUsageTracker } from "./codex-context-usage-tracker";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";
import type { CodexSessionContextUsage } from "./types";

const tokenUsageNotification = (
  totalTokens: number,
  contextWindow = 200_000,
  threadId = "thread/start-runtime-live",
) => ({
  method: "thread/tokenUsage/updated",
  params: {
    threadId,
    turnId: "turn-1",
    tokenUsage: {
      total: { totalTokens },
      last: { totalTokens },
      modelContextWindow: contextWindow,
    },
  },
});

const expectNoContextReadOrResume = (transport?: RecordingTransport): void => {
  expect(
    transport?.calls.filter(
      (call) => call.method === "thread/read" || call.method === "thread/resume",
    ) ?? [],
  ).toEqual([]);
};

describe("CodexContextUsageTracker", () => {
  test("shares a synchronously reentrant load", async () => {
    const tracker = new CodexContextUsageTracker();
    const callbackRan = createDeferred<void>();
    let nestedLoad: Promise<CodexSessionContextUsage | null> | null = null;
    let resumeAttempts = 0;

    const outerLoad = tracker.load("runtime-live", "thread-idle", async () => {
      resumeAttempts += 1;
      nestedLoad = tracker.load("runtime-live", "thread-idle", async () => {
        resumeAttempts += 1;
      });
      callbackRan.resolve(undefined);
    });

    await callbackRan.promise;
    if (!nestedLoad) {
      throw new Error("Expected reentrant context load.");
    }
    expect(resumeAttempts).toBe(1);
    await expect(Promise.all([outerLoad, nestedLoad])).resolves.toEqual([null, null]);
    expect(resumeAttempts).toBe(1);
  });
});

describe("CodexAppServerAdapter context loading", () => {
  test("returns retained context without a Codex read or resume", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    runtimeStream.emitNotification(tokenUsageNotification(1_000));
    await flushCodexAdapterWork();

    const usage = await adapter.loadLiveSessionContextUsage({
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
    });

    expect(usage).toEqual({ totalTokens: 1_000, contextWindow: 200_000 });
    expect(
      transports
        .get("runtime-live")
        ?.calls.filter((call) => call.method === "thread/read" || call.method === "thread/resume"),
    ).toEqual([]);
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([
      expect.objectContaining({
        ref: {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
          externalSessionId: "thread/start-runtime-live",
        },
        contextUsage: { totalTokens: 1_000, contextWindow: 200_000 },
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);
  });

  test("updates retained context to zero when cumulative usage remains positive", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter } = createHarness({ subscribeEvents: runtimeStream.subscribeEvents });
    await adapter.startSession(codexStartSessionInput());
    runtimeStream.emitNotification(tokenUsageNotification(42_000));
    await flushCodexAdapterWork();
    runtimeStream.emitNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread/start-runtime-live",
        turnId: "turn-2",
        tokenUsage: {
          total: { totalTokens: 42_000 },
          last: { totalTokens: 0 },
          modelContextWindow: 200_000,
        },
      },
    });
    await flushCodexAdapterWork();

    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.contextUsage).toEqual({
      totalTokens: 0,
      contextWindow: 200_000,
    });
  });

  test("returns null immediately after a successful resume without usage", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());

    await expect(adapter.loadSessionContextUsage(codexSessionRef())).resolves.toBeNull();
    expect(
      transports.get("runtime-live")?.calls.filter((call) => call.method === "thread/resume"),
    ).toHaveLength(1);
  });

  test("shares concurrent missing-context loads and returns null to both callers", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
    const resumeStarted = createDeferred<void>();
    const resume = createDeferred<void>();
    let resumeAttempts = 0;
    if (transport && request) {
      transport.request = async <Response>(input): Promise<Response> => {
        if (input.method === "thread/resume") {
          resumeAttempts += 1;
          resumeStarted.resolve(undefined);
          await resume.promise;
        }
        return request<Response>(input);
      };
    }

    const firstLoad = adapter.loadSessionContextUsage(codexSessionRef());
    await resumeStarted.promise;
    const secondLoad = adapter.loadSessionContextUsage(codexSessionRef());

    expect(resumeAttempts).toBe(1);
    resume.resolve(undefined);
    await expect(Promise.all([firstLoad, secondLoad])).resolves.toEqual([null, null]);
    expect(resumeAttempts).toBe(1);
  });

  test("returns usage observed while resume is outstanding", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
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

  test("propagates usage arriving after a null result through the live snapshot", async () => {
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

  test("retains an unloaded session after a successful null resume", async () => {
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

  test("keeps the runtime stream for a bound cold load after another session is released", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    if (transport && request) {
      transport.request = async <Response>(input): Promise<Response> => {
        if (input.method === "thread/resume") {
          resumeStarted.resolve(undefined);
          await resume.promise;
        }
        return request<Response>(input);
      };
    }

    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    await resumeStarted.promise;
    await adapter.releaseSession(codexSessionRef());

    expect(runtimeStream.unsubscribedRuntimeIds).toEqual([]);
    runtimeStream.emitNotification(tokenUsageNotification(3_000, 200_000, "thread-idle"));
    await flushCodexAdapterWork();
    resume.resolve(undefined);

    await expect(loading).resolves.toEqual({ totalTokens: 3_000, contextWindow: 200_000 });
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
        contextUsage: { totalTokens: 3_000, contextWindow: 200_000 },
      }),
    ]);
    expect(runtimeStream.unsubscribedRuntimeIds).toEqual([]);
  });

  test("stops the runtime stream after a bound cold load fails following another session release", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    if (transport) {
      transport.request = async (input) => {
        if (input.method === "thread/resume") {
          resumeStarted.resolve(undefined);
          await resume.promise;
          throw new Error("resume unavailable");
        }
        throw new Error(`Unexpected Codex request '${input.method}'.`);
      };
    }

    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    await resumeStarted.promise;
    await adapter.releaseSession(codexSessionRef());

    expect(runtimeStream.unsubscribedRuntimeIds).toEqual([]);
    resume.resolve(undefined);
    await expect(loading).rejects.toThrow("resume unavailable");
    await flushCodexAdapterWork();

    expect(runtimeStream.unsubscribedRuntimeIds).toEqual(["runtime-live"]);
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("fails actionably and permits a later explicit resume retry", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
    let resumeAttempts = 0;
    if (transport && request) {
      transport.request = async <Response>(input): Promise<Response> => {
        if (input.method === "thread/resume") {
          resumeAttempts += 1;
          if (resumeAttempts === 1) {
            throw new Error("resume unavailable");
          }
        }
        return request<Response>(input);
      };
    }

    await expect(adapter.loadSessionContextUsage(codexSessionRef())).rejects.toThrow(
      "resume unavailable",
    );
    await expect(adapter.loadSessionContextUsage(codexSessionRef())).resolves.toBeNull();
    expect(resumeAttempts).toBe(2);
  });
  test("rejects a cold load promptly when its session is released without resurrecting state", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const transport = new RecordingTransport("runtime-live", false);
    const { adapter } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
      transportFactory: () => transport,
    });
    const request = transport.request.bind(transport);
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    const resumeCompleted = createDeferred<void>();
    transport.request = async <Response>(input): Promise<Response> => {
      if (input.method === "thread/resume") {
        resumeStarted.resolve(undefined);
        await resume.promise;
        const response = await request<Response>(input);
        resumeCompleted.resolve(undefined);
        return response;
      }
      return request<Response>(input);
    };

    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    await resumeStarted.promise;
    await adapter.releaseSession(codexSessionRef("thread-idle"));

    await expect(loading).rejects.toThrow("was released while loading context usage");
    expect(adapter.listLiveSessionSnapshots("runtime-live")).not.toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({
          externalSessionId: "thread-idle",
          repoPath: "/repo",
          workingDirectory: "/repo",
        }),
      }),
    );
    resume.resolve(undefined);
    await resumeCompleted.promise;
    await flushCodexAdapterWork();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("rejects a cold load promptly when its runtime is released without resurrecting state", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const transport = new RecordingTransport("runtime-live", false);
    const { adapter } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
      transportFactory: () => transport,
    });
    const request = transport.request.bind(transport);
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    const resumeCompleted = createDeferred<void>();
    transport.request = async <Response>(input): Promise<Response> => {
      if (input.method === "thread/resume") {
        resumeStarted.resolve(undefined);
        await resume.promise;
        const response = await request<Response>(input);
        resumeCompleted.resolve(undefined);
        return response;
      }
      return request<Response>(input);
    };

    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    await resumeStarted.promise;
    adapter.releaseRuntime("runtime-live");

    await expect(loading).rejects.toThrow("was released while loading context usage");
    expect(adapter.listLiveSessionSnapshots("runtime-live")).not.toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
      }),
    );
    resume.resolve(undefined);
    await resumeCompleted.promise;
    await flushCodexAdapterWork();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("rejects a retained live load promptly when its session is released", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    const resumeCompleted = createDeferred<void>();
    if (transport && request) {
      transport.request = async <Response>(input): Promise<Response> => {
        if (input.method === "thread/resume") {
          resumeStarted.resolve(undefined);
          await resume.promise;
          const response = await request<Response>(input);
          resumeCompleted.resolve(undefined);
          return response;
        }
        return request<Response>(input);
      };
    }

    const loading = adapter.loadLiveSessionContextUsage({
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
    });
    await resumeStarted.promise;
    await adapter.releaseSession(codexSessionRef());

    await expect(loading).rejects.toThrow("was released while loading context usage");
    resume.resolve(undefined);
    await resumeCompleted.promise;
    await flushCodexAdapterWork();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("cancels a retained live context load when its session is stopped", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    const resumeCompleted = createDeferred<void>();
    if (transport && request) {
      transport.request = async <Response>(input): Promise<Response> => {
        if (input.method === "thread/resume") {
          resumeStarted.resolve(undefined);
          await resume.promise;
          const response = await request<Response>(input);
          resumeCompleted.resolve(undefined);
          return response;
        }
        return request<Response>(input);
      };
    }

    const loading = adapter.loadLiveSessionContextUsage({
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
    });
    await resumeStarted.promise;
    await adapter.stopSession(codexSessionRef());

    await expect(loading).rejects.toThrow("was released while loading context usage");
    expect(runtimeStream.unsubscribedRuntimeIds).toEqual(["runtime-live"]);
    resume.resolve(undefined);
    await resumeCompleted.promise;
    await flushCodexAdapterWork();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
    expect(runtimeStream.unsubscribedRuntimeIds).toEqual(["runtime-live"]);
  });

  test("rejects a retained live load promptly when its runtime is released", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    const resumeCompleted = createDeferred<void>();
    if (transport && request) {
      transport.request = async <Response>(input): Promise<Response> => {
        if (input.method === "thread/resume") {
          resumeStarted.resolve(undefined);
          await resume.promise;
          const response = await request<Response>(input);
          resumeCompleted.resolve(undefined);
          return response;
        }
        return request<Response>(input);
      };
    }

    const loading = adapter.loadLiveSessionContextUsage({
      runtimeId: "runtime-live",
      externalSessionId: "thread/start-runtime-live",
    });
    await resumeStarted.promise;
    adapter.releaseRuntime("runtime-live");

    await expect(loading).rejects.toThrow("was released while loading context usage");
    resume.resolve(undefined);
    await resumeCompleted.promise;
    await flushCodexAdapterWork();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("rejects a session release during runtime resolution without resuming or retaining", async () => {
    const ref = codexSessionRef("thread-idle");
    const runtime = createDeferred<ReturnType<typeof makeRuntimeSummary>>();
    const { adapter, transports } = createHarness({
      repoRuntimeResolver: { requireRepoRuntime: () => runtime.promise },
    });

    const loading = adapter.loadSessionContextUsage(ref);
    await adapter.releaseSession(ref);

    await expect(loading).rejects.toThrow("was released while loading context usage");
    runtime.resolve(makeRuntimeSummary("runtime-live"));
    expectNoContextReadOrResume(transports.get("runtime-live"));
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("rejects a runtime release during runtime resolution without resuming or retaining", async () => {
    const runtime = createDeferred<ReturnType<typeof makeRuntimeSummary>>();
    const { adapter, transports } = createHarness({
      repoRuntimeResolver: { requireRepoRuntime: () => runtime.promise },
    });

    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    adapter.releaseRuntime("runtime-live");
    runtime.resolve(makeRuntimeSummary("runtime-live"));

    await expect(loading).rejects.toThrow("was released while loading context usage");
    expectNoContextReadOrResume(transports.get("runtime-live"));
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("rejects a session release during runtime preparation without resuming or retaining", async () => {
    const ref = codexSessionRef("thread-idle");
    const preparationStarted = createDeferred<void>();
    const preparation = createDeferred<() => void>();
    const { adapter, transports } = createHarness({
      subscribeEvents: () => {
        preparationStarted.resolve(undefined);
        return preparation.promise;
      },
    });

    const loading = adapter.loadSessionContextUsage(ref);
    await preparationStarted.promise;
    await adapter.releaseSession(ref);

    await expect(loading).rejects.toThrow("was released while loading context usage");
    preparation.resolve(() => {});
    expectNoContextReadOrResume(transports.get("runtime-live"));
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("rejects a runtime release during runtime preparation without resuming or retaining", async () => {
    const preparationStarted = createDeferred<void>();
    const preparation = createDeferred<() => void>();
    const { adapter, transports } = createHarness({
      subscribeEvents: () => {
        preparationStarted.resolve(undefined);
        return preparation.promise;
      },
    });

    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    await preparationStarted.promise;
    adapter.releaseRuntime("runtime-live");

    await expect(loading).rejects.toThrow("was released while loading context usage");
    preparation.resolve(() => {});
    expectNoContextReadOrResume(transports.get("runtime-live"));
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("does not cancel a context load when a mismatched retained-session release is rejected", async () => {
    const ref = codexSessionRef("thread-idle");
    const transport = new RecordingTransport("runtime-live", false);
    const originalRequest = transport.request.bind(transport);
    const firstResumeStarted = createDeferred<void>();
    const unblockFirstResume = createDeferred<void>();
    let resumeCount = 0;
    transport.request = async <Response>(input): Promise<Response> => {
      const response = await originalRequest<Response>(input);
      if (input.method === "thread/resume") {
        resumeCount += 1;
        if (resumeCount === 1) {
          firstResumeStarted.resolve(undefined);
          await unblockFirstResume.promise;
        }
      }
      return response;
    };
    const { adapter } = createHarness({ transportFactory: () => transport });

    const loading = adapter.loadSessionContextUsage(ref);
    await firstResumeStarted.promise;
    await adapter.resumeSession(codexSessionRuntimeRef("thread-idle"));
    await expect(adapter.releaseSession({ ...ref, repoPath: "/other-repo" })).rejects.toThrow(
      "Cannot release Codex session",
    );
    unblockFirstResume.resolve(undefined);

    await expect(loading).resolves.toBeNull();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
      }),
    );
  });
  test("cancels a matching blocked load before failing session cleanup", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const transport = new RecordingTransport("runtime-live", false);
    const { adapter } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
      transportFactory: () => transport,
    });
    const request = transport.request.bind(transport);
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    transport.request = async <Response>(input): Promise<Response> => {
      if (input.method === "thread/resume") {
        resumeStarted.resolve(undefined);
        await resume.promise;
      }
      return request<Response>(input);
    };
    const loading = adapter.loadSessionContextUsage(codexSessionRef("thread-idle"));
    await resumeStarted.promise;
    await adapter.startSession(codexStartSessionInput());
    const localSessions = adapter as unknown as {
      localSessions: {
        get(id: string): { summary: { externalSessionId: string }; threadId: string } | undefined;
        remember(session: unknown): void;
        release(id: string): void;
      };
    };
    const retained = localSessions.localSessions.get("thread/start-runtime-live");
    if (!retained) {
      throw new Error("Expected retained session.");
    }
    localSessions.localSessions.remember({
      ...retained,
      threadId: "thread-idle",
      summary: { ...retained.summary, externalSessionId: "thread-idle" },
    });
    const release = localSessions.localSessions.release.bind(localSessions.localSessions);
    localSessions.localSessions.release = (id) => {
      release(id);
      throw new Error("cleanup failed");
    };

    await expect(adapter.releaseSession(codexSessionRef("thread-idle"))).rejects.toThrow(
      "cleanup failed",
    );
    resume.resolve(undefined);
    await expect(loading).rejects.toThrow("was released while loading context usage");
    expect(adapter.listLiveSessionSnapshots("runtime-live")).not.toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
      }),
    );
  });
});

describe("CodexAppServerAdapter live child projection", () => {
  test("rejects a blocked routed-child context load when the child is released", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const adapterState = adapter as unknown as { subagents: CodexSubagentLinkState };
    adapterState.subagents.upsertLink({
      runtimeId: "runtime-live",
      parentThreadId: "thread/start-runtime-live",
      childThreadId: "child-thread",
      itemId: "child-thread",
      status: "running",
    });
    const transport = transports.get("runtime-live");
    const request = transport?.request.bind(transport);
    const resume = createDeferred<void>();
    const resumeStarted = createDeferred<void>();
    const resumeCompleted = createDeferred<void>();
    if (transport && request) {
      transport.request = async <Response>(input): Promise<Response> => {
        if (input.method === "thread/resume") {
          resumeStarted.resolve(undefined);
          await resume.promise;
          const response = await request<Response>(input);
          resumeCompleted.resolve(undefined);
          return response;
        }
        return request<Response>(input);
      };
    }
    const childRef = { ...codexSessionRef(), externalSessionId: "child-thread" };

    const loading = adapter.loadLiveSessionContextUsage({
      runtimeId: "runtime-live",
      externalSessionId: childRef.externalSessionId,
    });
    await resumeStarted.promise;
    await adapter.releaseSession(childRef);

    await expect(loading).rejects.toThrow("was released while loading context usage");
    resume.resolve(undefined);
    await resumeCompleted.promise;
    await flushCodexAdapterWork();
    expect(
      adapter
        .listLiveSessionSnapshots("runtime-live")
        .find((snapshot) => snapshot.ref.externalSessionId === childRef.externalSessionId),
    ).toEqual(
      expect.objectContaining({
        ref: expect.objectContaining({
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
          externalSessionId: childRef.externalSessionId,
        }),
        parentExternalSessionId: "thread/start-runtime-live",
        contextUsage: null,
      }),
    );
  });

  test("projects and routes pending input for an unloaded child session", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, respondServerRequest, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const adapterState = adapter as unknown as {
      pendingInput: CodexPendingInputState;
      subagents: CodexSubagentLinkState;
    };
    const route = {
      runtimeId: "runtime-live",
      parentExternalSessionId: "thread/start-runtime-live",
      childExternalSessionId: "child-thread",
      subagentCorrelationKey: "codex-subagent:thread/start-runtime-live:child-thread",
    };
    adapterState.subagents.upsertLink({
      runtimeId: "runtime-live",
      parentThreadId: route.parentExternalSessionId,
      childThreadId: route.childExternalSessionId,
      itemId: route.childExternalSessionId,
      status: "running",
    });
    const approval = adapterState.pendingInput.addApproval({
      runtimeId: "runtime-live",
      threadId: route.childExternalSessionId,
      nativeRequest: {
        id: 7,
        method: "item/commandExecution/requestApproval",
        params: { threadId: route.childExternalSessionId },
      },
      request: {
        requestType: "permission_grant",
        title: "Approve child command",
      },
      route,
    });
    const question = adapterState.pendingInput.addQuestion({
      runtimeId: "runtime-live",
      threadId: route.childExternalSessionId,
      nativeRequest: {
        id: 7,
        method: "item/tool/requestUserInput",
        params: { threadId: route.childExternalSessionId },
      },
      request: {
        questions: [{ header: "Confirm", question: "Proceed?", options: [] }],
      },
      questionIds: ["question-1"],
      input: { questions: [{ header: "Confirm", question: "Proceed?", options: [] }] },
      route,
    });

    expect(adapter.listLiveSessionSnapshots("runtime-live")).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "child-thread" }),
        parentExternalSessionId: "thread/start-runtime-live",
        activity: "waiting_for_question",
        pendingApprovals: [
          expect.objectContaining({ requestId: approval.entry.request.requestId }),
        ],
        pendingQuestions: [
          expect.objectContaining({ requestId: question.entry.request.requestId }),
        ],
      }),
    );

    const transport = transports.get("runtime-live");
    expect(transport).toBeDefined();
    const originalRequest = transport?.request.bind(transport);
    const resumeResponseDelivered = createDeferred<void>();
    if (transport && originalRequest) {
      transport.request = async <Response>(request): Promise<Response> => {
        const response = await originalRequest<Response>(request);
        if (request.method === "thread/resume") {
          resumeResponseDelivered.resolve(undefined);
        }
        return response;
      };
    }
    const contextLoading = adapter.loadLiveSessionContextUsage({
      runtimeId: "runtime-live",
      externalSessionId: route.childExternalSessionId,
    });
    await resumeResponseDelivered.promise;
    await expect(contextLoading).resolves.toBeNull();
    runtimeStream.emitNotification(
      tokenUsageNotification(4_200, 200_000, route.childExternalSessionId),
    );
    await flushCodexAdapterWork();
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: route.childExternalSessionId }),
        contextUsage: { totalTokens: 4_200, contextWindow: 200_000 },
      }),
    );
    expect(transport?.calls.filter((call) => call.method === "thread/resume")).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          threadId: route.childExternalSessionId,
          excludeTurns: false,
        }),
      }),
    ]);

    await adapter.replyLiveApproval({
      runtimeId: "runtime-live",
      externalSessionId: "child-thread",
      requestId: approval.entry.request.requestId,
      outcome: "approve_once",
    });
    await adapter.replyLiveQuestion({
      runtimeId: "runtime-live",
      externalSessionId: "child-thread",
      requestId: question.entry.request.requestId,
      answers: [["Yes"]],
    });

    expect(respondServerRequest).toHaveBeenNthCalledWith(
      1,
      "runtime-live",
      7,
      { decision: "accept" },
      undefined,
    );
    expect(respondServerRequest).toHaveBeenNthCalledWith(
      2,
      "runtime-live",
      7,
      { answers: { "question-1": { answers: ["Yes"] } } },
      undefined,
    );
    expect(
      adapter
        .listLiveSessionSnapshots("runtime-live")
        .find((snapshot) => snapshot.ref.externalSessionId === "child-thread"),
    ).toMatchObject({ pendingApprovals: [], pendingQuestions: [], activity: "running" });
  });
});
