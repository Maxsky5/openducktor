import { describe, expect, test } from "bun:test";
import type { PrepareOpencodeSessionRuntime } from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter";
import {
  createLifecycle,
  createRuntimeHarness,
  ref,
  runtime,
} from "./opencode-live-session-adapter.test-support";

describe("createOpenCodeLiveSessionAdapterPreparer", () => {
  test("refreshes only OpenDucktor-registered roots from OpenCode", async () => {
    const harness = createRuntimeHarness({
      registeredSources: [
        {
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "Known builder",
          startedAt: "2026-07-16T10:00:00.000Z",
          runtimeActivity: "running",
          pendingApprovals: [
            {
              requestId: "permission-1",
              requestType: "file_change",
              title: "Edit a file",
            },
          ],
          pendingQuestions: [],
        },
      ],
    });
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );

    const refreshRegisteredSessions = prepared.adapter.refreshRegisteredSessions;
    if (!refreshRegisteredSessions) {
      throw new Error("Expected OpenCode to support registered-session refresh.");
    }
    await Effect.runPromise(refreshRegisteredSessions([ref]));

    expect(harness.refreshRegisteredSessionCalls).toEqual([["session-1"]]);
    await expect(Effect.runPromise(prepared.adapter.listSnapshots("/repo"))).resolves.toEqual([
      expect.objectContaining({
        ref,
        activity: "waiting_for_permission",
        pendingApprovals: [expect.objectContaining({ requestId: "opencode-pending-1" })],
      }),
    ]);
  });

  test("removes current state when OpenCode deletes an owned session", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());

    await harness.emit({ type: "session_removed", externalSessionId: ref.externalSessionId });

    await expect(Effect.runPromise(prepared.adapter.listSnapshots(ref.repoPath))).resolves.toEqual(
      [],
    );
    expect(publishedChanges).toContainEqual({ type: "session_removed", ref });
  });

  test("owns strict snapshots, opaque replies, current context, and normalized signals", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    const adapter = prepared.adapter;
    await Effect.runPromise(
      adapter.resumeSession({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "question_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:01.000Z",
        requestId: "question-1",
        questions: [
          {
            header: "Confirm",
            question: "Continue?",
            options: [{ label: "Yes", description: "Continue" }],
          },
        ],
      },
    });
    await harness.emit({
      type: "context_updated",
      externalSessionId: "session-1",
      contextUsage: {
        totalTokens: 321,
        model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      },
    });

    const snapshots = await Effect.runPromise(adapter.listSnapshots("/repo"));
    expect(snapshots).toEqual([
      {
        ref,
        activity: "waiting_for_question",
        title: "Controlled session",
        startedAt: "2026-07-16T10:02:00.000Z",
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

    publishedChanges.length = 0;
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
      type: "session_event",
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

  test("clears current pending input when a session errors", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    const adapter = prepared.adapter;
    await Effect.runPromise(
      adapter.resumeSession({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });
    const before = await Effect.runPromise(adapter.readSnapshot(ref));
    if (before.type !== "live") {
      throw new Error("Expected the OpenCode session to be current.");
    }
    const approvalRequestId = before.session.pendingApprovals[0]?.requestId;
    if (!approvalRequestId) {
      throw new Error("Expected a pending OpenCode approval.");
    }

    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "session_error",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:04:00.000Z",
        message: "Turn failed.",
      },
    });

    await expect(Effect.runPromise(adapter.readSnapshot(ref))).resolves.toMatchObject({
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

  test("does not restore a released session when an earlier registered refresh finishes", async () => {
    const harness = createRuntimeHarness({
      registeredSources: [
        {
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "Known builder",
          startedAt: "2026-07-16T10:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      ],
    });
    let markReadStarted: () => void = () => undefined;
    let finishRead: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    const basePrepare = harness.prepareRuntime;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await basePrepare(input);
      return {
        ...prepared,
        connection: {
          ...prepared.connection,
          refreshRegisteredSessions: async (refs) => {
            markReadStarted();
            await readGate;
            return prepared.connection.refreshRegisteredSessions(refs);
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
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    const refreshRegisteredSessions = prepared.adapter.refreshRegisteredSessions;
    if (!refreshRegisteredSessions) {
      throw new Error("Expected OpenCode to support registered-session refresh.");
    }

    const refresh = Effect.runPromise(refreshRegisteredSessions([ref]));
    await readStarted;
    const release = Effect.runPromise(prepared.adapter.releaseSession(ref));
    const releaseFinishedWhileReadWaited = await Promise.race([
      release.then(() => true),
      Bun.sleep(200).then(() => false),
    ]);
    finishRead();
    await Promise.all([refresh, release]);

    expect(releaseFinishedWhileReadWaited).toBe(true);
    await expect(Effect.runPromise(prepared.adapter.readSnapshot(ref))).resolves.toEqual({
      type: "missing",
      ref,
    });
    await Effect.runPromise(prepared.adapter.releaseRuntime());
  });

  test("keeps missing-context work demand-driven and shares one in-flight request", async () => {
    const harness = createRuntimeHarness();
    let resolveContext: (value: { totalTokens: number }) => void = () => undefined;
    const contextGate = new Promise<{ totalTokens: number }>((resolve) => {
      resolveContext = resolve;
    });
    const originalPrepare = harness.prepareRuntime;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
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
    const adapter = prepared.adapter;

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
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );

    await expect(Effect.runPromise(prepared.adapter.loadContext(ref))).resolves.toEqual({
      totalTokens: 999,
      providerId: "openai",
      modelId: "gpt-5.1",
    });
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
    await expect(Effect.runPromise(prepared.adapter.listSnapshots("/repo"))).resolves.toEqual([]);
  });

  test("keeps pending replies usable after context or native reply failures", async () => {
    const harness = createRuntimeHarness();
    const originalPrepare = harness.prepareRuntime;
    let approvalAttempts = 0;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
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
    const adapter = prepared.adapter;
    await Effect.runPromise(
      adapter.resumeSession({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });

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

    const afterFailures = await Effect.runPromise(adapter.readSnapshot(ref));
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
    const afterReply = await Effect.runPromise(adapter.readSnapshot(ref));
    expect(afterReply).toMatchObject({ type: "live", session: { pendingApprovals: [] } });
    expect(harness.approvalReplies).toHaveLength(1);
  });

  test("isolates identical native request ids across runtime adapters", async () => {
    const firstHarness = createRuntimeHarness();
    const secondHarness = createRuntimeHarness();
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
    const firstAdapter = first.adapter;
    const secondAdapter = second.adapter;
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
    await Effect.runPromise(firstAdapter.resumeSession({ ...ref, sessionScope }));
    await Effect.runPromise(secondAdapter.resumeSession({ ...secondRef, sessionScope }));
    await Effect.runPromise(first.startForwarding());
    await Effect.runPromise(second.startForwarding());
    await firstHarness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });
    await secondHarness.emit({
      type: "session_event",
      externalSessionId: "session-2",
      event: {
        type: "approval_required",
        externalSessionId: "session-2",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });
    const firstSnapshot = await Effect.runPromise(firstAdapter.readSnapshot(ref));
    const secondSnapshot = await Effect.runPromise(secondAdapter.readSnapshot(secondRef));
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
    const retainedSecond = await Effect.runPromise(secondAdapter.readSnapshot(secondRef));
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
      readWorkflowRoots: () => Effect.succeed([]),
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
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );

    const otherRef = { ...ref, runtimeKind: "codex" as const, externalSessionId: "session-2" };
    const otherSnapshot: AgentSessionLiveSnapshot = {
      ref: otherRef,
      activity: "idle",
      title: "Other runtime session",
      startedAt: "2026-07-16T10:02:00.000Z",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
    const otherAdapter: AgentSessionLiveAdapterPort = {
      supportsSessionControl: false,
      binding: { runtimeId: "runtime-2", runtimeKind: "codex", repoPath: "/repo" },
      listSnapshots: (repoPath) => Effect.succeed(repoPath === "/repo" ? [otherSnapshot] : []),
      readSnapshot: (candidate) =>
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

    const current = await Effect.runPromise(service.list({ repoPath: "/repo" }));
    expect(current.map((snapshot) => snapshot.ref.externalSessionId)).toEqual(["session-2"]);
    expect(harness.releaseCalls).toEqual(["runtime-1"]);
    expect(envelopes.map((envelope) => envelope.type)).toEqual(["fault", "session_removed"]);
    await Effect.runPromise(service.releaseRuntime("runtime-2"));
  });

  test("keeps a live event newer than an overlapping refresh", async () => {
    const harness = createRuntimeHarness();
    const nextRef = { ...ref, externalSessionId: "session-2" };
    let markRefreshReadStarted: () => void = () => undefined;
    let finishRefreshRead: () => void = () => undefined;
    let markEventCommitStarted: () => void = () => undefined;
    const refreshReadStarted = new Promise<void>((resolve) => {
      markRefreshReadStarted = resolve;
    });
    const refreshReadGate = new Promise<void>((resolve) => {
      finishRefreshRead = resolve;
    });
    const eventCommitStarted = new Promise<void>((resolve) => {
      markEventCommitStarted = resolve;
    });
    let blockRefresh = false;
    const basePrepare = harness.prepareRuntime;
    const readRefs = (refs: ReadonlyArray<AgentSessionLiveRef>) =>
      refs.map((candidate) => ({
        type: "present" as const,
        ref: candidate,
        sources: [
          {
            externalSessionId: candidate.externalSessionId,
            workingDirectory: candidate.workingDirectory,
            sessionAssociation: { kind: "unbound" as const },
            title: `Known ${candidate.externalSessionId}`,
            startedAt: "2026-07-16T10:00:00.000Z",
            runtimeActivity: "running" as const,
            pendingApprovals: [],
            pendingQuestions: [],
          },
        ],
      }));
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await basePrepare(input);
      return {
        ...prepared,
        connection: {
          ...prepared.connection,
          refreshRegisteredSessions: async (refs) => {
            if (!blockRefresh) {
              return readRefs(refs);
            }
            markRefreshReadStarted();
            await refreshReadGate;
            return readRefs(refs);
          },
        },
      };
    };
    const adapterRegistry = createLiveSessionAdapterRegistry();
    let roots = [ref];
    const service = createAgentSessionLiveStateService({
      adapterRegistry,
      readWorkflowRoots: () => Effect.succeed(roots),
      faultLog: () => Effect.void,
      publish: () => undefined,
    });
    let adapterCommitCount = 0;
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: {
          releaseRuntime: service.releaseRuntime,
          runAdapterMutation: (mutation) => {
            adapterCommitCount += 1;
            if (adapterCommitCount === 1) {
              markEventCommitStarted();
            }
            return service.runAdapterMutation(mutation);
          },
        },
        prepareRuntime,
      })(runtime),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(prepared.startForwarding());

    roots = [ref, nextRef];
    blockRefresh = true;
    const refresh = Effect.runPromise(service.refresh({ repoPath: ref.repoPath }));
    await refreshReadStarted;
    const event = harness.emit({
      type: "session_event",
      externalSessionId: ref.externalSessionId,
      event: {
        type: "session_idle",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-07-16T10:04:00.000Z",
      },
    });
    const eventPassedRefresh = await Promise.race([
      eventCommitStarted.then(() => true),
      Bun.sleep(50).then(() => false),
    ]);
    expect(eventPassedRefresh).toBe(true);
    finishRefreshRead();

    await Promise.all([refresh, event]);
    await expect(
      Effect.runPromise(service.list({ repoPath: ref.repoPath })),
    ).resolves.toMatchObject([
      { ref, activity: "idle" },
      { ref: nextRef, activity: "running" },
    ]);
  });
});
