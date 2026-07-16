import { describe, expect, test } from "bun:test";
import {
  codexSessionRef,
  codexStartSessionInput,
  createDeferred,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";

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

  test("shares one include-turns resume for concurrent missing-context loads", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());

    const first = adapter.loadSessionContextUsage(codexSessionRef());
    const second = adapter.loadSessionContextUsage(codexSessionRef());
    await Promise.resolve();
    runtimeStream.emitNotification(tokenUsageNotification(2_000));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { totalTokens: 2_000, contextWindow: 200_000 },
      { totalTokens: 2_000, contextWindow: 200_000 },
    ]);
    expect(
      transports.get("runtime-live")?.calls.filter((call) => call.method === "thread/resume"),
    ).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          threadId: "thread/start-runtime-live",
          excludeTurns: false,
        }),
      }),
    ]);
  });

  test("waits for matching context usage emitted after the resume response", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const resumeResponseDelivered = createDeferred<void>();
    const transport = transports.get("runtime-live");
    expect(transport).toBeDefined();
    const originalRequest = transport?.request.bind(transport);
    if (transport && originalRequest) {
      transport.request = async <Response>(request): Promise<Response> => {
        const response = await originalRequest<Response>(request);
        if (request.method === "thread/resume") {
          resumeResponseDelivered.resolve(undefined);
        }
        return response;
      };
    }

    const loading = adapter.loadSessionContextUsage(codexSessionRef());
    const outcome = loading.then(
      (usage) => ({ status: "resolved" as const, usage }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await resumeResponseDelivered.promise;
    await flushCodexAdapterWork();
    runtimeStream.emitNotification(tokenUsageNotification(2_100));

    await expect(outcome).resolves.toEqual({
      status: "resolved",
      usage: { totalTokens: 2_100, contextWindow: 200_000 },
    });
  });

  test("retains a previously unloaded session after successful include-turns recovery", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const transport = new RecordingTransport("runtime-live", false);
    const originalRequest = transport.request.bind(transport);
    transport.request = async <Response>(request): Promise<Response> => {
      const response = await originalRequest<Response>(request);
      if (request.method === "thread/resume") {
        runtimeStream.emitNotification(tokenUsageNotification(2_250, 200_000, "thread-idle"));
      }
      return response;
    };
    const { adapter } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
      transportFactory: () => transport,
    });

    await expect(adapter.loadSessionContextUsage(codexSessionRef("thread-idle"))).resolves.toEqual({
      totalTokens: 2_250,
      contextWindow: 200_000,
    });
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ externalSessionId: "thread-idle" }),
        contextUsage: { totalTokens: 2_250, contextWindow: 200_000 },
      }),
    );
    expect(
      transport.calls.filter((call) =>
        ["thread/resume", "thread/read", "turn/start"].includes(call.method),
      ),
    ).toEqual([
      expect.objectContaining({
        method: "thread/resume",
        params: expect.objectContaining({ threadId: "thread-idle", excludeTurns: false }),
      }),
    ]);
  });

  test("preserves the first replayed usage when resume-window notifications overlap", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const resumeResponse = createDeferred<void>();
    const transport = transports.get("runtime-live");
    expect(transport).toBeDefined();
    const originalRequest = transport?.request.bind(transport);
    if (transport && originalRequest) {
      transport.request = async <Response>(request): Promise<Response> => {
        const response = await originalRequest<Response>(request);
        if (request.method === "thread/resume") {
          await resumeResponse.promise;
        }
        return response;
      };
    }

    const loading = adapter.loadSessionContextUsage(codexSessionRef());
    while (!transport?.calls.some((call) => call.method === "thread/resume")) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    runtimeStream.emitNotification(tokenUsageNotification(2_000));
    runtimeStream.emitNotification(tokenUsageNotification(2_500));
    resumeResponse.resolve(undefined);

    await expect(loading).resolves.toEqual({ totalTokens: 2_000, contextWindow: 200_000 });
  });

  test("does not let a later persisted replay overwrite a live update during recovery", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const resumeResponse = createDeferred<void>();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    expect(transport).toBeDefined();
    const originalRequest = transport?.request.bind(transport);
    if (transport && originalRequest) {
      transport.request = async <Response>(request): Promise<Response> => {
        const response = await originalRequest<Response>(request);
        if (request.method === "thread/resume") {
          await resumeResponse.promise;
        }
        return response;
      };
    }

    const loading = adapter.loadSessionContextUsage(codexSessionRef());
    while (!transport?.calls.some((call) => call.method === "thread/resume")) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    runtimeStream.emitNotification(tokenUsageNotification(3_000));
    runtimeStream.emitNotification(tokenUsageNotification(1_000));
    resumeResponse.resolve(undefined);

    await expect(loading).resolves.toEqual({ totalTokens: 3_000, contextWindow: 200_000 });
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.contextUsage).toEqual({
      totalTokens: 3_000,
      contextWindow: 200_000,
    });
  });

  test("fails actionably and allows retry after a failed resume", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const transport = transports.get("runtime-live");
    expect(transport).toBeDefined();
    const originalRequest = transport?.request.bind(transport);
    let resumeAttempts = 0;
    if (transport && originalRequest) {
      transport.request = async <Response>(request): Promise<Response> => {
        if (request.method === "thread/resume") {
          resumeAttempts += 1;
          if (resumeAttempts === 1) {
            throw new Error("resume unavailable");
          }
        }
        return originalRequest<Response>(request);
      };
    }

    await expect(adapter.loadSessionContextUsage(codexSessionRef())).rejects.toThrow(
      "Failed to load Codex context usage for runtime 'runtime-live' session 'thread/start-runtime-live': resume unavailable",
    );

    const retry = adapter.loadSessionContextUsage(codexSessionRef());
    await Promise.resolve();
    runtimeStream.emitNotification(tokenUsageNotification(3_000));
    await expect(retry).resolves.toEqual({ totalTokens: 3_000, contextWindow: 200_000 });
    expect(resumeAttempts).toBe(2);
  });

  test("fails a post-resume context wait when its session is released", async () => {
    const runtimeStream = createRuntimeStreamSubscription();
    const { adapter, transports } = createHarness({
      subscribeEvents: runtimeStream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    const resumeResponseDelivered = createDeferred<void>();
    const transport = transports.get("runtime-live");
    expect(transport).toBeDefined();
    const originalRequest = transport?.request.bind(transport);
    if (transport && originalRequest) {
      transport.request = async <Response>(request): Promise<Response> => {
        const response = await originalRequest<Response>(request);
        if (request.method === "thread/resume") {
          resumeResponseDelivered.resolve(undefined);
        }
        return response;
      };
    }

    const loading = adapter.loadSessionContextUsage(codexSessionRef());
    await resumeResponseDelivered.promise;
    await adapter.releaseSession(codexSessionRef());

    await expect(loading).rejects.toThrow(
      "Codex session 'thread/start-runtime-live' was released while context usage was loading",
    );
  });
});

describe("CodexAppServerAdapter live child projection", () => {
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
    if (transport && originalRequest) {
      transport.request = async <Response>(request): Promise<Response> => {
        if (request.method === "thread/resume") {
          runtimeStream.emitNotification(
            tokenUsageNotification(4_200, 200_000, route.childExternalSessionId),
          );
        }
        return originalRequest<Response>(request);
      };
    }
    await expect(
      adapter.loadLiveSessionContextUsage({
        runtimeId: "runtime-live",
        externalSessionId: route.childExternalSessionId,
      }),
    ).resolves.toEqual({ totalTokens: 4_200, contextWindow: 200_000 });
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
