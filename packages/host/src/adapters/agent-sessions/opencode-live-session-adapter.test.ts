import { describe, expect, test } from "bun:test";
import type { PrepareOpencodeSessionRuntime } from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterPort,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter";
import {
  createLifecycle,
  createRuntimeHarness,
  nativeSource,
  ref,
  runtime,
} from "./opencode-live-session-adapter.test-support";

describe("createOpenCodeLiveSessionAdapterPreparer", () => {
  test("owns strict snapshots, opaque replies, retained context, and normalized signals", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    // SAFETY: This test controls the fixture and supplies `AgentSessionRuntimeAdapterPort` used by this case.
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;

    const snapshots = await Effect.runPromise(adapter.listRetainedSnapshots("/repo"));
    expect(snapshots).toEqual([
      {
        ref,
        sessionAssociation: { kind: "unbound" },
        activity: "waiting_for_question",
        title: "Live OpenCode session",
        startedAt: "2026-07-16T10:01:00.000Z",
        pendingApprovals: [
          {
            requestId: "opencode-pending-1",
            requestType: "file_change",
            title: "Edit a file",
          },
        ],
        pendingQuestions: [
          {
            requestId: "opencode-pending-2",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          },
        ],
        contextUsage: {
          totalTokens: 321,
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
        },
      } satisfies AgentSessionLiveSnapshot,
    ]);
    await expect(Effect.runPromise(adapter.loadContext(ref))).resolves.toEqual({
      totalTokens: 321,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
    expect(harness.contextLoadCalls).toEqual([]);

    await Effect.runPromise(
      adapter.replyApproval({
        ...ref,
        requestId: "opencode-pending-1",
        outcome: "approve_once",
      }),
    );
    await Effect.runPromise(
      adapter.replyQuestion({
        ...ref,
        requestId: "opencode-pending-2",
        answers: [["Yes"]],
      }),
    );
    expect(harness.approvalReplies).toEqual([
      {
        ref,
        nativeRequestId: "permission-1",
        outcome: "approve_once",
      },
    ]);
    expect(harness.questionReplies).toEqual([
      {
        ref,
        nativeRequestId: "question-1",
        answers: [["Yes"]],
      },
    ]);
    expect(publishedChanges.filter((change) => change.type === "session_upsert")).toHaveLength(2);

    publishedChanges.length = 0;
    await Effect.runPromise(prepared.startForwarding());
    const transcriptEvent = {
      type: "assistant_delta",
      externalSessionId: "session-1",
      timestamp: "2026-07-16T10:04:00.000Z",
      channel: "text",
      delta: "hello",
    } satisfies Omit<
      Extract<AgentSessionTranscriptEvent, { type: "assistant_delta" }>,
      "sessionRef"
    >;
    await harness.emit({
      type: "transcript_event",
      externalSessionId: "session-1",
      event: transcriptEvent,
    });
    await harness.emit({
      type: "fault",
      message: "OpenCode live event observation failed: connection lost",
    });
    expect(publishedChanges).toEqual([
      {
        type: "transcript_event",
        event: { ...transcriptEvent, sessionRef: ref },
      },
      {
        type: "fault",
        repoPath: "/repo",
        operation: "opencode-live-session.observe-runtime",
        message: "OpenCode live event observation failed: connection lost",
      },
    ]);
  });

  test("clears retained pending input when a session errors", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    // SAFETY: This test controls the fixture and supplies `AgentSessionRuntimeAdapterPort` used by this case.
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;
    const before = await Effect.runPromise(adapter.readRetainedSnapshot(ref));
    if (before.type !== "live") {
      throw new Error("Expected the OpenCode session to be retained.");
    }
    const approvalRequestId = before.session.pendingApprovals[0]?.requestId;
    if (!approvalRequestId) {
      throw new Error("Expected a pending OpenCode approval.");
    }

    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "transcript_event",
      externalSessionId: "session-1",
      event: {
        type: "session_error",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:04:00.000Z",
        message: "Turn failed.",
      },
    });

    await expect(Effect.runPromise(adapter.readRetainedSnapshot(ref))).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });
    await expect(
      Effect.runPromise(
        adapter.replyApproval({
          ...ref,
          requestId: approvalRequestId,
          outcome: "approve_once",
        }),
      ),
    ).rejects.toThrow("Unknown or resolved OpenCode approval occurrence");
    expect(publishedChanges).toContainEqual({
      type: "session_upsert",
      snapshot: expect.objectContaining({
        ref,
        activity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    });

    await Effect.runPromise(adapter.releaseRuntime());
  });

  test("keeps missing-context work demand-driven and shares one in-flight request", async () => {
    const harness = createRuntimeHarness();
    harness.setSources([
      nativeSource({
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    ]);
    let resolveContext: (value: { totalTokens: number }) => void = () => undefined;
    const contextGate = new Promise<{ totalTokens: number }>((resolve) => {
      resolveContext = resolve;
    });
    const originalPrepare = harness.prepareRuntime;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
        initialContextUsageBySessionId: new Map(),
        connection: {
          ...prepared.connection,
          loadContextUsage: async (sessionRef) => {
            harness.contextLoadCalls.push(sessionRef.externalSessionId);
            return contextGate;
          },
        },
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime),
    );
    // SAFETY: This test controls the fixture and supplies `AgentSessionRuntimeAdapterPort` used by this case.
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;

    const first = Effect.runPromise(adapter.loadContext(ref));
    const second = Effect.runPromise(adapter.loadContext(ref));
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
    resolveContext({ totalTokens: 77 });

    await expect(first).resolves.toEqual({ totalTokens: 77 });
    await expect(second).resolves.toEqual({ totalTokens: 77 });
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
  });

  test("loads context for a persisted session without retaining a live snapshot", async () => {
    const harness = createRuntimeHarness();
    harness.setSources([]);
    const originalPrepare = harness.prepareRuntime;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
        initialContextUsageBySessionId: new Map(),
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime),
    );

    await expect(Effect.runPromise(prepared.adapter.loadContext(ref))).resolves.toEqual({
      totalTokens: 999,
      providerId: "openai",
      modelId: "gpt-5.1",
    });
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
    await expect(
      Effect.runPromise(prepared.adapter.listRetainedSnapshots("/repo")),
    ).resolves.toEqual([]);
  });

  test("keeps pending replies usable after context or native reply failures", async () => {
    const harness = createRuntimeHarness();
    const originalPrepare = harness.prepareRuntime;
    let approvalAttempts = 0;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
        initialContextUsageBySessionId: new Map(),
        connection: {
          ...prepared.connection,
          loadContextUsage: async () => {
            throw new Error("context endpoint unavailable");
          },
          replyApproval: async (reply) => {
            approvalAttempts += 1;
            if (approvalAttempts === 1) {
              throw new Error("approval endpoint unavailable");
            }
            await prepared.connection.replyApproval(reply);
          },
        },
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime),
    );
    // SAFETY: This test controls the fixture and supplies `AgentSessionRuntimeAdapterPort` used by this case.
    const adapter = prepared.adapter as AgentSessionRuntimeAdapterPort;

    await expect(Effect.runPromise(adapter.loadContext(ref))).rejects.toThrow(
      "context endpoint unavailable",
    );
    await expect(
      Effect.runPromise(
        adapter.replyApproval({
          ...ref,
          requestId: "opencode-pending-1",
          outcome: "approve_once",
        }),
      ),
    ).rejects.toThrow("approval endpoint unavailable");

    const afterFailures = await Effect.runPromise(adapter.readRetainedSnapshot(ref));
    expect(afterFailures).toMatchObject({
      type: "live",
      session: { pendingApprovals: [{ requestId: "opencode-pending-1" }] },
    });

    await Effect.runPromise(
      adapter.replyApproval({
        ...ref,
        requestId: "opencode-pending-1",
        outcome: "approve_once",
      }),
    );
    const afterReply = await Effect.runPromise(adapter.readRetainedSnapshot(ref));
    expect(afterReply).toMatchObject({ type: "live", session: { pendingApprovals: [] } });
    expect(harness.approvalReplies).toHaveLength(1);
  });

  test("isolates identical native request ids across runtime adapters", async () => {
    const firstHarness = createRuntimeHarness();
    const secondHarness = createRuntimeHarness();
    secondHarness.setSources([
      nativeSource({
        externalSessionId: "session-2",
        pendingQuestions: [],
      }),
    ]);
    const secondRuntime: RuntimeInstanceSummary = {
      ...runtime,
      runtimeId: "runtime-2",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43124" },
    };
    const secondRef = { ...ref, externalSessionId: "session-2" };
    const prepareAdapter = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: createLifecycle([]),
      prepareRuntime: (input) =>
        input.runtimeId === runtime.runtimeId
          ? firstHarness.prepareRuntime(input)
          : secondHarness.prepareRuntime(input),
    });

    const first = await Effect.runPromise(prepareAdapter(runtime));
    const second = await Effect.runPromise(prepareAdapter(secondRuntime));
    // SAFETY: This test controls the fixture and supplies `AgentSessionRuntimeAdapterPort` used by this case.
    const firstAdapter = first.adapter as AgentSessionRuntimeAdapterPort;
    // SAFETY: This test controls the fixture and supplies `AgentSessionRuntimeAdapterPort` used by this case.
    const secondAdapter = second.adapter as AgentSessionRuntimeAdapterPort;
    const firstSnapshot = await Effect.runPromise(firstAdapter.readRetainedSnapshot(ref));
    const secondSnapshot = await Effect.runPromise(secondAdapter.readRetainedSnapshot(secondRef));
    if (firstSnapshot.type !== "live" || secondSnapshot.type !== "live") {
      throw new Error("Expected both OpenCode runtime snapshots to be live.");
    }
    const firstRequestId = firstSnapshot.session.pendingApprovals[0]?.requestId;
    const secondRequestId = secondSnapshot.session.pendingApprovals[0]?.requestId;
    if (!firstRequestId || !secondRequestId) {
      throw new Error("Expected both OpenCode runtimes to retain a pending approval.");
    }
    expect(firstRequestId).not.toBe(secondRequestId);

    await Effect.runPromise(
      firstAdapter.replyApproval({
        ...ref,
        requestId: firstRequestId,
        outcome: "approve_once",
      }),
    );
    const retainedSecond = await Effect.runPromise(secondAdapter.readRetainedSnapshot(secondRef));
    expect(retainedSecond).toMatchObject({
      type: "live",
      session: { pendingApprovals: [{ requestId: secondRequestId }] },
    });
    expect(firstHarness.approvalReplies[0]?.nativeRequestId).toBe("permission-1");
    expect(secondHarness.approvalReplies).toEqual([]);
  });

  test("releases only the owning adapter after an observation fault", async () => {
    const harness = createRuntimeHarness();
    const envelopes: Array<{ type: string }> = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      publish: (envelope) => envelopes.push(envelope),
    });
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: service,
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));

    const otherRef = { ...ref, externalSessionId: "session-2" };
    const otherSnapshot: AgentSessionLiveSnapshot = {
      ref: otherRef,
      sessionAssociation: { kind: "unbound" },
      activity: "idle",
      title: "Other runtime session",
      startedAt: "2026-07-16T10:02:00.000Z",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
    const otherAdapter: AgentSessionLiveAdapterPort = {
      binding: { runtimeId: "runtime-2", runtimeKind: "opencode", repoPath: "/repo" },
      matches: (candidate) => candidate.externalSessionId === otherRef.externalSessionId,
      listRetainedSnapshots: (repoPath) =>
        Effect.succeed(repoPath === "/repo" ? [otherSnapshot] : []),
      readRetainedSnapshot: (candidate) =>
        Effect.succeed(
          candidate.externalSessionId === otherRef.externalSessionId
            ? ({ type: "live", session: otherSnapshot } as const)
            : ({ type: "missing", ref: candidate } as const),
        ),
      loadContext: () => Effect.succeed(null),
      replyApproval: () => Effect.void,
      replyQuestion: () => Effect.void,
      releaseRuntime: () => Effect.succeed([otherRef]),
    };
    await Effect.runPromise(service.registerRuntimeAdapter(otherAdapter));
    await Effect.runPromise(prepared.startForwarding());
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    envelopes.length = 0;

    await harness.emit({
      type: "fault",
      message: "OpenCode live event observation failed: connection lost",
    });

    const retained = await Effect.runPromise(service.list({ repoPath: "/repo" }));
    expect(retained.map((snapshot) => snapshot.ref.externalSessionId)).toEqual(["session-2"]);
    expect(harness.releaseCalls).toEqual(["runtime-1"]);
    expect(envelopes.map((envelope) => envelope.type)).toEqual(["fault", "session_removed"]);
    await Effect.runPromise(service.releaseRuntime("runtime-2"));
  });
});
