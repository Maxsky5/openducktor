import { describe, expect, test } from "bun:test";
import {
  type AgentSessionControlSummary,
  type RepoConfig,
  RUNTIME_DESCRIPTORS_BY_KIND,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  ClaudeAgentSdkService,
  ClaudePendingInputResolution,
} from "../../application/runtimes/claude-agent-sdk-service";
import type { ClaudeWorkspaceWorkingDirectoryDependencies } from "../../application/runtimes/claude-workspace-runtime";
import { HostOperationError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import { AsyncInputQueue } from "../claude/claude-agent-sdk-queue";
import type { ClaudeSessionContext, ClaudeSessionStore } from "../claude/claude-agent-sdk-types";
import {
  createClaudeAgentSdkEventHub,
  createClaudeLiveSessionAdapterPreparer,
} from "./claude-live-session-adapter";

const runtime = {
  kind: "claude" as const,
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace" as const,
  workingDirectory: "/repo",
  runtimeRoute: { type: "host_service" as const, identity: "runtime-1" },
  startedAt: "2026-07-17T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
};

const workingDirectoryDependencies = {
  settingsConfig: {
    canonicalizePath: (path: string) => Effect.succeed(path),
    defaultRepoWorktreeBasePath: () => "/legacy-worktrees/repo",
    defaultWorktreeBasePath: () => "/worktrees/repo",
    resolveConfiguredPath: (path: string) => path,
  },
  workspaceSettingsService: {
    getRepoConfigByRepoPath: () =>
      Effect.succeed({
        workspaceId: "repo",
        worktreeBasePath: "/worktrees/repo",
      } as RepoConfig),
  },
};

const summary = {
  externalSessionId: "session-1",
  runtimeKind: "claude",
  workingDirectory: "/repo/worktree",
  title: "Claude build",
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  startedAt: "2026-07-17T10:01:00.000Z",
  status: "idle",
} as const satisfies AgentSessionControlSummary;

const session: ClaudeSessionContext = {
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    systemPrompt: "Build",
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-1",
  startedAt: summary.startedAt,
  summary,
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolEndedAtMsByCallId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
  todosById: new Map(),
};

const startInput = {
  repoPath: "/repo",
  runtimeKind: "claude" as const,
  workingDirectory: "/repo/worktree",
  sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
  systemPrompt: "Build",
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createHarness = async (
  workingDirectoryDependenciesOverride: ClaudeWorkspaceWorkingDirectoryDependencies = workingDirectoryDependencies,
) => {
  const changes: AgentSessionLiveAdapterChange[] = [];
  const eventHub = createClaudeAgentSdkEventHub();
  let startSessionImpl: ClaudeAgentSdkService["startSession"] = () =>
    Effect.die("startSession was not configured");
  let forkSessionImpl: ClaudeAgentSdkService["forkSession"] = () =>
    Effect.die("forkSession was not configured");
  let resumeSessionImpl: ClaudeAgentSdkService["resumeSession"] = () => Effect.succeed(summary);
  let loadSessionContextUsageImpl: ClaudeAgentSdkService["loadSessionContextUsage"] = () =>
    Effect.die("loadSessionContextUsage was not configured");
  let sendUserMessageImpl: ClaudeAgentSdkService["sendUserMessage"] = () =>
    Effect.die("sendUserMessage was not configured");
  let prepareApprovalReplyImpl: ClaudeAgentSdkService["prepareApprovalReply"] = () =>
    Effect.die("prepareApprovalReply was not configured");
  let prepareQuestionReplyImpl: ClaudeAgentSdkService["prepareQuestionReply"] = () =>
    Effect.die("prepareQuestionReply was not configured");
  let updateSessionModelImpl: ClaudeAgentSdkService["updateSessionModel"] = () =>
    Effect.die("updateSessionModel was not configured");
  let stopSessionImpl: ClaudeAgentSdkService["stopSession"] = () => Effect.void;
  let releaseSessionImpl: ClaudeAgentSdkService["releaseSession"] = () => Effect.void;
  let stopSessionsForRuntimeImpl: ClaudeAgentSdkService["stopSessionsForRuntime"] = () =>
    Effect.void;
  let failNextMutationAfterApply = false;
  let mutationBarrier:
    | {
        entered: ReturnType<typeof deferred<void>>;
        release: ReturnType<typeof deferred<void>>;
      }
    | undefined;
  startSessionImpl = () => {
    eventHub.emit(session, {
      type: "session_started",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:00.000Z",
      message: "Started build session",
    });
    eventHub.emit(session, {
      type: "session_idle",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:01.000Z",
    });
    return Effect.succeed(summary);
  };
  const service = {
    startSession: (
      input: Parameters<ClaudeAgentSdkService["startSession"]>[0],
      runtimeId: string,
    ) => startSessionImpl(input, runtimeId),
    forkSession: (input: Parameters<ClaudeAgentSdkService["forkSession"]>[0], runtimeId: string) =>
      forkSessionImpl(input, runtimeId),
    resumeSession: (
      input: Parameters<ClaudeAgentSdkService["resumeSession"]>[0],
      runtimeId: string,
    ) => resumeSessionImpl(input, runtimeId),
    loadSessionContextUsage: (
      input: Parameters<ClaudeAgentSdkService["loadSessionContextUsage"]>[0],
    ) => loadSessionContextUsageImpl(input),
    sendUserMessage: (
      input: Parameters<ClaudeAgentSdkService["sendUserMessage"]>[0],
      runtimeId: string,
    ) => sendUserMessageImpl(input, runtimeId),
    prepareApprovalReply: (input: Parameters<ClaudeAgentSdkService["prepareApprovalReply"]>[0]) =>
      prepareApprovalReplyImpl(input),
    prepareQuestionReply: (input: Parameters<ClaudeAgentSdkService["prepareQuestionReply"]>[0]) =>
      prepareQuestionReplyImpl(input),
    updateSessionModel: (input: Parameters<ClaudeAgentSdkService["updateSessionModel"]>[0]) =>
      updateSessionModelImpl(input),
    stopSession: (input: Parameters<ClaudeAgentSdkService["stopSession"]>[0]) =>
      stopSessionImpl(input),
    stopSessionsForRuntime: (runtimeId: string) => stopSessionsForRuntimeImpl(runtimeId),
    releaseSession: (input: Parameters<ClaudeAgentSdkService["releaseSession"]>[0]) =>
      releaseSessionImpl(input),
  } as unknown as ClaudeAgentSdkService;
  const liveSessionLifecycle: Pick<RuntimeLiveSessionLifecyclePort, "runAdapterMutation"> = {
    runAdapterMutation: (mutation) => {
      const barrier = mutationBarrier;
      mutationBarrier = undefined;
      const waitForBarrier = barrier
        ? Effect.promise(async () => {
            barrier.entered.resolve();
            await barrier.release.promise;
          })
        : Effect.void;
      return waitForBarrier.pipe(
        Effect.zipRight(
          Effect.flatMap(mutation, ({ value, changes: mutationChanges }) => {
            if (failNextMutationAfterApply) {
              failNextMutationAfterApply = false;
              return Effect.fail(
                new HostOperationError({
                  operation: "test.publish",
                  message: "Publication failed.",
                }),
              );
            }
            changes.push(...mutationChanges);
            return Effect.succeed(value);
          }),
        ),
      );
    },
  };
  const prepare = createClaudeLiveSessionAdapterPreparer({
    eventHub,
    liveSessionLifecycle,
    service,
    sessionStore: {
      get: (externalSessionId) =>
        externalSessionId === session.externalSessionId
          ? (session as unknown as ReturnType<ClaudeSessionStore["get"]>)
          : undefined,
    } as ClaudeSessionStore,
    workingDirectoryDependencies: workingDirectoryDependenciesOverride,
  });
  const prepared = await Effect.runPromise(prepare(runtime));
  await Effect.runPromise(prepared.startForwarding());
  return {
    adapter: prepared.adapter as AgentSessionRuntimeAdapterPort,
    changes,
    eventHub,
    setStartSession: (implementation: ClaudeAgentSdkService["startSession"]) => {
      startSessionImpl = implementation;
    },
    setForkSession: (implementation: ClaudeAgentSdkService["forkSession"]) => {
      forkSessionImpl = implementation;
    },
    setResumeSession: (implementation: ClaudeAgentSdkService["resumeSession"]) => {
      resumeSessionImpl = implementation;
    },
    setLoadSessionContextUsage: (
      implementation: ClaudeAgentSdkService["loadSessionContextUsage"],
    ) => {
      loadSessionContextUsageImpl = implementation;
    },
    pauseNextMutation: () => {
      const barrier = { entered: deferred<void>(), release: deferred<void>() };
      mutationBarrier = barrier;
      return barrier;
    },
    failNextMutationAfterStateApply: () => {
      failNextMutationAfterApply = true;
    },
    setPrepareApprovalReply: (implementation: ClaudeAgentSdkService["prepareApprovalReply"]) => {
      prepareApprovalReplyImpl = implementation;
    },
    setPrepareQuestionReply: (implementation: ClaudeAgentSdkService["prepareQuestionReply"]) => {
      prepareQuestionReplyImpl = implementation;
    },
    setSendUserMessage: (implementation: ClaudeAgentSdkService["sendUserMessage"]) => {
      sendUserMessageImpl = implementation;
    },
    setUpdateSessionModel: (implementation: ClaudeAgentSdkService["updateSessionModel"]) => {
      updateSessionModelImpl = implementation;
    },
    setStopSession: (implementation: ClaudeAgentSdkService["stopSession"]) => {
      stopSessionImpl = implementation;
    },
    setReleaseSession: (implementation: ClaudeAgentSdkService["releaseSession"]) => {
      releaseSessionImpl = implementation;
    },
    setStopSessionsForRuntime: (
      implementation: ClaudeAgentSdkService["stopSessionsForRuntime"],
    ) => {
      stopSessionsForRuntimeImpl = implementation;
    },
  };
};

const transcriptEventTypes = (changes: readonly AgentSessionLiveAdapterChange[]): string[] =>
  changes.flatMap((change) => (change.type === "transcript_event" ? [change.event.type] : []));

describe("Claude host live-session adapter", () => {
  test("forwards repository controls after workspace validation", async () => {
    const harness = await createHarness();
    const repositoryInput = {
      ...startInput,
      sessionScope: { kind: "repository" } as const,
    };
    const repositorySummary = {
      ...summary,
      title: "Repository session",
      sessionAssociation: { kind: "repository" } as const,
    };
    const calls: Array<{ operation: string; sessionScope: unknown; runtimeId: string }> = [];
    harness.setStartSession((input, runtimeId) => {
      calls.push({ operation: "start", sessionScope: input.sessionScope, runtimeId });
      return Effect.succeed(repositorySummary);
    });
    harness.setResumeSession((input, runtimeId) => {
      calls.push({ operation: "resume", sessionScope: input.sessionScope, runtimeId });
      return Effect.succeed(repositorySummary);
    });
    harness.setForkSession((input, runtimeId) => {
      calls.push({ operation: "fork", sessionScope: input.sessionScope, runtimeId });
      return Effect.succeed(repositorySummary);
    });
    const loadContextScopes: unknown[] = [];
    harness.setLoadSessionContextUsage((input) => {
      loadContextScopes.push(input.sessionScope);
      return Effect.succeed(null);
    });
    harness.setSendUserMessage((input, runtimeId) => {
      calls.push({ operation: "send", sessionScope: input.sessionScope, runtimeId });
      return Effect.succeed({
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp: "2026-07-17T10:02:00.000Z",
        messageId: "user-1",
        message: "Start",
        parts: [{ kind: "text", text: "Start" }],
        state: "read",
      });
    });

    await Effect.runPromise(harness.adapter.startSession(repositoryInput));
    await Effect.runPromise(
      harness.adapter.resumeSession({ ...repositoryInput, externalSessionId: "session-1" }),
    );
    await Effect.runPromise(
      harness.adapter.forkSession({
        ...repositoryInput,
        parentExternalSessionId: "parent-session",
      }),
    );
    await Effect.runPromise(
      harness.adapter.sendUserMessage({
        ...repositoryInput,
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Start" }],
      }),
    );
    await Effect.runPromise(
      harness.adapter.loadContext({
        ...repositoryInput,
        externalSessionId: "session-1",
      }),
    );

    expect(calls).toEqual([
      { operation: "start", sessionScope: { kind: "repository" }, runtimeId: "runtime-1" },
      { operation: "resume", sessionScope: { kind: "repository" }, runtimeId: "runtime-1" },
      { operation: "fork", sessionScope: { kind: "repository" }, runtimeId: "runtime-1" },
      { operation: "send", sessionScope: { kind: "repository" }, runtimeId: "runtime-1" },
    ]);
    expect(loadContextScopes).toEqual([{ kind: "repository" }]);
  });

  test("rejects session operations outside the selected workspace before calling the SDK", async () => {
    const harness = await createHarness();
    const sdkCalls = { start: 0, resume: 0, fork: 0, loadContext: 0, sendUserMessage: 0 };
    harness.setStartSession(() => {
      sdkCalls.start += 1;
      return Effect.succeed(summary);
    });
    harness.setResumeSession(() => {
      sdkCalls.resume += 1;
      return Effect.succeed(summary);
    });
    harness.setForkSession(() => {
      sdkCalls.fork += 1;
      return Effect.succeed(summary);
    });
    harness.setLoadSessionContextUsage(() => {
      sdkCalls.loadContext += 1;
      return Effect.succeed(null);
    });
    harness.setSendUserMessage(() => {
      sdkCalls.sendUserMessage += 1;
      return Effect.die("sendUserMessage should not be called");
    });
    const outsideWorkspaceInput = {
      ...startInput,
      workingDirectory: "/private",
    };
    const attempts = [
      harness.adapter.startSession(outsideWorkspaceInput).pipe(Effect.asVoid),
      harness.adapter
        .resumeSession({
          ...outsideWorkspaceInput,
          externalSessionId: "session-1",
        })
        .pipe(Effect.asVoid),
      harness.adapter
        .forkSession({
          ...outsideWorkspaceInput,
          parentExternalSessionId: "parent-session",
        })
        .pipe(Effect.asVoid),
      harness.adapter
        .loadContext({
          ...outsideWorkspaceInput,
          externalSessionId: "session-1",
        })
        .pipe(Effect.asVoid),
      harness.adapter
        .sendUserMessage({
          ...outsideWorkspaceInput,
          externalSessionId: "session-1",
          parts: [{ kind: "text", text: "Start" }],
        })
        .pipe(Effect.asVoid),
    ];

    for (const attempt of attempts) {
      expect(await Effect.runPromise(Effect.either(attempt))).toMatchObject({
        _tag: "Left",
        left: {
          _tag: "HostValidationError",
          field: "workingDirectory",
        },
      });
    }
    expect(sdkCalls).toEqual({
      start: 0,
      resume: 0,
      fork: 0,
      loadContext: 0,
      sendUserMessage: 0,
    });
  });

  test("keeps a no-message start idle after SDK initialization settles", async () => {
    const harness = await createHarness();
    harness.setStartSession(() =>
      Effect.promise(async () => {
        harness.eventHub.emit(session, {
          type: "session_started",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:01:00.000Z",
          message: "Started build session",
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return summary;
      }),
    );

    await expect(
      Effect.runPromise(harness.adapter.startSession(startInput)),
    ).resolves.toMatchObject({
      externalSessionId: "session-1",
      status: "idle",
    });

    expect(
      await Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
    expect(transcriptEventTypes(harness.changes)).toEqual(["session_started"]);
  });

  test("keeps a no-message fork idle after SDK initialization settles", async () => {
    const harness = await createHarness();
    harness.setForkSession(() =>
      Effect.promise(async () => {
        harness.eventHub.emit(session, {
          type: "session_started",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:01:00.000Z",
          message: "Forked build session",
        });
        harness.eventHub.emit(session, {
          type: "session_idle",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:01:01.000Z",
        });
        return summary;
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.forkSession({
          ...startInput,
          parentExternalSessionId: "parent-session",
        }),
      ),
    ).resolves.toMatchObject({
      externalSessionId: "session-1",
      status: "idle",
    });

    const retained = await Effect.runPromise(
      harness.adapter.readRetainedSnapshot({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    expect(retained).toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
    if (retained.type !== "live") {
      throw new Error("Expected retained fork snapshot.");
    }
    expect(retained.session.parentExternalSessionId).toBeUndefined();
  });

  test("publishes accepted input before draining its runtime response", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    harness.setSendUserMessage((input) =>
      Effect.promise(async () => {
        harness.eventHub.emit(session, {
          type: "session_status",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:00.000Z",
          status: { type: "busy", message: null },
        });
        harness.eventHub.emit(session, {
          type: "assistant_message",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:01.000Z",
          messageId: "assistant-1",
          message: "Done",
        });
        harness.eventHub.emit(session, {
          type: "session_idle",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:02.000Z",
        });
        await Promise.resolve();
        return {
          type: "user_message" as const,
          externalSessionId: input.externalSessionId,
          timestamp: "2026-07-17T10:01:59.000Z",
          messageId: "user-1",
          message: "Start",
          parts: [{ kind: "text" as const, text: "Start" }],
          state: "read" as const,
        };
      }),
    );

    await Effect.runPromise(
      harness.adapter.sendUserMessage({
        ...startInput,
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Start" }],
      }),
    );

    expect(transcriptEventTypes(harness.changes)).toEqual([
      "user_message",
      "session_status",
      "assistant_message",
      "session_idle",
    ]);
  });

  test("reattaches live events when sending to a stopped session", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    await Effect.runPromise(
      harness.adapter.stopSession({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    harness.changes.splice(0);
    harness.setSendUserMessage((input) =>
      Effect.promise(async () => {
        harness.eventHub.emit(session, {
          type: "session_started",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:00.000Z",
          message: "Resumed build session",
        });
        harness.eventHub.emit(session, {
          type: "session_status",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:01.000Z",
          status: { type: "busy", message: null },
        });
        harness.eventHub.emit(session, {
          type: "assistant_message",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:02.000Z",
          messageId: "assistant-1",
          message: "Done",
        });
        harness.eventHub.emit(session, {
          type: "session_idle",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:02:03.000Z",
        });
        return {
          type: "user_message" as const,
          externalSessionId: input.externalSessionId,
          timestamp: "2026-07-17T10:01:59.000Z",
          messageId: "user-1",
          message: "Resume",
          parts: [{ kind: "text" as const, text: "Resume" }],
          state: "read" as const,
        };
      }),
    );

    await Effect.runPromise(
      harness.adapter.sendUserMessage({
        ...startInput,
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Resume" }],
      }),
    );

    expect(harness.changes[0]).toMatchObject({
      type: "transcript_event",
      event: { type: "user_message" },
    });
    expect(transcriptEventTypes(harness.changes)).toEqual([
      "user_message",
      "session_started",
      "session_status",
      "assistant_message",
      "session_idle",
    ]);
    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
  });

  test("keeps pending activity when an already-retained session is resumed", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "approval_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "approval-1",
      requestType: "command_execution",
      title: "Approve command",
      supportedReplyOutcomes: ["approve_once", "reject"],
    });

    await Effect.runPromise(
      harness.adapter.resumeSession({
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_permission",
        pendingApprovals: [{ requestId: "approval-1" }],
      },
    });
  });

  test("keeps a retained running session running when it is resumed", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "session_status",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      status: { type: "busy", message: null },
    });

    await Effect.runPromise(
      harness.adapter.resumeSession({
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { activity: "running" },
    });
  });

  test("keeps a retained pending question intact when it is resumed", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "question_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "question-1",
      questions: [
        {
          question: "Proceed?",
          header: "Decision",
          options: [{ label: "Yes", description: "Continue." }],
          multiple: false,
          custom: true,
        },
      ],
    });

    await Effect.runPromise(
      harness.adapter.resumeSession({
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_question",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ question: "Proceed?", header: "Decision" }],
          },
        ],
      },
    });
  });

  test("does not release an approval until its live resolution is published", async () => {
    const harness = await createHarness();
    const completed: string[] = [];
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "approval_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "approval-1",
      requestType: "command_execution",
      title: "Approve command",
      supportedReplyOutcomes: ["approve_once", "reject"],
    });
    const resolution = {
      event: {
        type: "approval_resolved",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:01:31.000Z",
        requestId: "approval-1",
      },
      complete: () => completed.push("approval-1"),
    } satisfies ClaudePendingInputResolution;
    harness.setPrepareApprovalReply(() => Effect.succeed(resolution));
    harness.failNextMutationAfterStateApply();

    await expect(
      Effect.runPromise(
        harness.adapter.replyApproval({
          ...startInput,
          externalSessionId: "session-1",
          requestId: "approval-1",
          outcome: "approve_once",
        }),
      ),
    ).rejects.toThrow("Publication failed.");

    expect(completed).toEqual([]);
    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_permission",
        pendingApprovals: [{ requestId: "approval-1" }],
      },
    });

    await Effect.runPromise(
      harness.adapter.replyApproval({
        ...startInput,
        externalSessionId: "session-1",
        requestId: "approval-1",
        outcome: "approve_once",
      }),
    );

    expect(completed).toEqual(["approval-1"]);
    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { pendingApprovals: [] },
    });
  });

  test("does not release a question until its live resolution is published", async () => {
    const harness = await createHarness();
    const completed: string[] = [];
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "question_required",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "question-1",
      questions: [
        {
          question: "Proceed?",
          header: "Decision",
          options: [{ label: "Yes", description: "Continue." }],
          multiple: false,
          custom: true,
        },
      ],
    });
    const resolution = {
      event: {
        type: "question_resolved",
        externalSessionId: "session-1",
        timestamp: "2026-07-17T10:01:31.000Z",
        requestId: "question-1",
      },
      complete: () => completed.push("question-1"),
    } satisfies ClaudePendingInputResolution;
    harness.setPrepareQuestionReply(() => Effect.succeed(resolution));
    harness.failNextMutationAfterStateApply();

    await expect(
      Effect.runPromise(
        harness.adapter.replyQuestion({
          ...startInput,
          externalSessionId: "session-1",
          requestId: "question-1",
          answers: [["Yes"]],
        }),
      ),
    ).rejects.toThrow("Publication failed.");

    expect(completed).toEqual([]);
    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "waiting_for_question",
        pendingQuestions: [{ requestId: "question-1" }],
      },
    });

    await Effect.runPromise(
      harness.adapter.replyQuestion({
        ...startInput,
        externalSessionId: "session-1",
        requestId: "question-1",
        answers: [["Yes"]],
      }),
    );

    expect(completed).toEqual(["question-1"]);
    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { pendingQuestions: [] },
    });
  });

  test("resolves a nested subagent approval through the root session", async () => {
    const harness = await createHarness();
    const completed: string[] = [];
    const parentExternalSessionId = "session-1::claude-subagent::outer-agent";
    const childExternalSessionId = `${parentExternalSessionId}::claude-subagent::nested-agent`;
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "approval_required",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId,
      childExternalSessionId,
      subagentCorrelationKey: "nested-agent",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "approval-1",
      requestType: "command_execution",
      title: "Approve command",
      supportedReplyOutcomes: ["approve_once", "reject"],
    });
    harness.setPrepareApprovalReply(() =>
      Effect.succeed({
        event: {
          type: "approval_resolved",
          externalSessionId: childExternalSessionId,
          parentExternalSessionId,
          childExternalSessionId,
          subagentCorrelationKey: "nested-agent",
          timestamp: "2026-07-17T10:01:31.000Z",
          requestId: "approval-1",
        },
        complete: () => completed.push("approval-1"),
      }),
    );

    await Effect.runPromise(
      harness.adapter.replyApproval({
        ...startInput,
        externalSessionId: childExternalSessionId,
        requestId: "approval-1",
        outcome: "approve_once",
      }),
    );

    expect(completed).toEqual(["approval-1"]);
    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: childExternalSessionId,
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { pendingApprovals: [] },
    });
  });

  test("resolves a nested subagent question through the root session", async () => {
    const harness = await createHarness();
    const completed: string[] = [];
    const parentExternalSessionId = "session-1::claude-subagent::outer-agent";
    const childExternalSessionId = `${parentExternalSessionId}::claude-subagent::nested-agent`;
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.eventHub.emit(session, {
      type: "question_required",
      externalSessionId: childExternalSessionId,
      parentExternalSessionId,
      childExternalSessionId,
      subagentCorrelationKey: "nested-agent",
      timestamp: "2026-07-17T10:01:30.000Z",
      requestId: "question-1",
      questions: [
        {
          question: "Proceed?",
          header: "Decision",
          options: [{ label: "Yes", description: "Continue." }],
          multiple: false,
          custom: true,
        },
      ],
    });
    harness.setPrepareQuestionReply(() =>
      Effect.succeed({
        event: {
          type: "question_resolved",
          externalSessionId: childExternalSessionId,
          parentExternalSessionId,
          childExternalSessionId,
          subagentCorrelationKey: "nested-agent",
          timestamp: "2026-07-17T10:01:31.000Z",
          requestId: "question-1",
        },
        complete: () => completed.push("question-1"),
      }),
    );

    await Effect.runPromise(
      harness.adapter.replyQuestion({
        ...startInput,
        externalSessionId: childExternalSessionId,
        requestId: "question-1",
        answers: [["Yes"]],
      }),
    );

    expect(completed).toEqual(["question-1"]);
    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: childExternalSessionId,
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { pendingQuestions: [] },
    });
  });

  test("uses the SDK summary when resuming a session that is not retained", async () => {
    const harness = await createHarness();
    harness.setResumeSession(() => Effect.succeed(summary));

    await Effect.runPromise(
      harness.adapter.resumeSession({
        ...startInput,
        externalSessionId: "session-1",
      }),
    );

    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({
      type: "live",
      session: { activity: "idle" },
    });
  });

  test("lets a direct context read replace an older event queued before the read", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setLoadSessionContextUsage(() =>
      Effect.succeed({ totalTokens: 120, contextWindow: 200 }),
    );
    const eventMutation = harness.pauseNextMutation();
    harness.eventHub.emit(session, {
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:02:00.000Z",
      totalTokens: 99,
      contextWindow: 200,
    });
    await eventMutation.entered.promise;

    const loadPromise = Effect.runPromise(
      harness.adapter.loadContext({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    eventMutation.release.resolve();

    await expect(loadPromise).resolves.toEqual({ totalTokens: 120, contextWindow: 200 });
  });

  test("keeps a context event that arrives during a direct read", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    const readStarted = deferred<void>();
    const directRead = deferred<{ totalTokens: number; contextWindow: number }>();
    harness.setLoadSessionContextUsage(() =>
      Effect.promise(async () => {
        readStarted.resolve();
        return directRead.promise;
      }),
    );

    const loadPromise = Effect.runPromise(
      harness.adapter.loadContext({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    await readStarted.promise;
    harness.eventHub.emit(session, {
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:02:00.000Z",
      totalTokens: 130,
      contextWindow: 200,
    });
    directRead.resolve({ totalTokens: 120, contextWindow: 200 });

    await expect(loadPromise).resolves.toEqual({ totalTokens: 130, contextWindow: 200 });
  });

  test("keeps an equal-valued context event that arrives during a direct read", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setLoadSessionContextUsage(() =>
      Effect.succeed({ totalTokens: 100, contextWindow: 200 }),
    );
    await Effect.runPromise(
      harness.adapter.loadContext({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );

    const readStarted = deferred<void>();
    const directRead = deferred<{ totalTokens: number; contextWindow: number }>();
    harness.setLoadSessionContextUsage(() =>
      Effect.promise(async () => {
        readStarted.resolve();
        return directRead.promise;
      }),
    );

    const loadPromise = Effect.runPromise(
      harness.adapter.loadContext({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );
    await readStarted.promise;
    harness.eventHub.emit(session, {
      type: "session_context_updated",
      externalSessionId: "session-1",
      timestamp: "2026-07-17T10:02:00.000Z",
      totalTokens: 100,
      contextWindow: 200,
    });
    directRead.resolve({ totalTokens: 120, contextWindow: 200 });

    await expect(loadPromise).resolves.toEqual({ totalTokens: 100, contextWindow: 200 });
  });

  test("publishes retractions but not status events buffered during release", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    harness.setReleaseSession(() =>
      Effect.sync(() => {
        harness.eventHub.emit(session, {
          type: "session_status",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:00.000Z",
          status: { type: "busy", message: null },
        });
        harness.eventHub.emit(session, {
          type: "transcript_retracted",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:01.000Z",
          messageIds: ["queued-user-1"],
        });
      }),
    );

    await Effect.runPromise(
      harness.adapter.releaseSession({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );

    expect(harness.changes).toEqual([
      {
        type: "transcript_event",
        event: expect.objectContaining({
          type: "transcript_retracted",
          messageIds: ["queued-user-1"],
        }),
      },
      {
        type: "session_removed",
        ref: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        },
      },
    ]);
  });

  test("publishes queued-message retraction and finish before removing a stopped session", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.changes.splice(0);
    harness.setStopSession(() =>
      Effect.sync(() => {
        harness.eventHub.emit(session, {
          type: "transcript_retracted",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:00.000Z",
          messageIds: ["queued-user-1"],
        });
        harness.eventHub.emit(session, {
          type: "session_finished",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:01.000Z",
          message: "Session stopped",
        });
      }),
    );

    await Effect.runPromise(
      harness.adapter.stopSession({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      }),
    );

    expect(transcriptEventTypes(harness.changes)).toEqual([
      "transcript_retracted",
      "session_finished",
    ]);
    expect(harness.changes.filter((change) => change.type === "session_removed")).toHaveLength(1);
  });

  test("retracts queued user messages while releasing the runtime", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    harness.setSendUserMessage((input) =>
      Effect.succeed({
        type: "user_message",
        externalSessionId: input.externalSessionId,
        timestamp: "2026-07-17T10:02:00.000Z",
        messageId: "queued-user-1",
        message: "Queued",
        parts: [{ kind: "text", text: "Queued" }],
        state: "queued",
      }),
    );
    await Effect.runPromise(
      harness.adapter.sendUserMessage({
        ...startInput,
        externalSessionId: "session-1",
        parts: [{ kind: "text", text: "Queued" }],
      }),
    );
    harness.changes.splice(0);
    harness.setStopSessionsForRuntime(() =>
      Effect.sync(() => {
        harness.eventHub.emit(session, {
          type: "transcript_retracted",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:00.000Z",
          messageIds: ["queued-user-1"],
        });
        harness.eventHub.emit(session, {
          type: "session_finished",
          externalSessionId: "session-1",
          timestamp: "2026-07-17T10:03:01.000Z",
          message: "Finished",
        });
      }),
    );

    await expect(Effect.runPromise(harness.adapter.releaseRuntime())).resolves.toEqual([
      {
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
    ]);
    expect(transcriptEventTypes(harness.changes)).toEqual(["transcript_retracted"]);
  });

  test("retains runtime state when cleanup fails so release can be retried", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.adapter.startSession(startInput));
    let cleanupAttempts = 0;
    harness.setStopSessionsForRuntime(() => {
      cleanupAttempts += 1;
      return cleanupAttempts === 1
        ? Effect.fail(
            new HostOperationError({
              operation: "test.stop-sessions",
              message: "Claude cleanup failed.",
            }),
          )
        : Effect.void;
    });

    await expect(Effect.runPromise(harness.adapter.releaseRuntime())).rejects.toThrow(
      "Claude cleanup failed.",
    );
    await expect(
      Effect.runPromise(
        harness.adapter.readRetainedSnapshot({
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo/worktree",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toMatchObject({ type: "live" });

    await expect(Effect.runPromise(harness.adapter.releaseRuntime())).resolves.toEqual([
      {
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
        externalSessionId: "session-1",
      },
    ]);
    expect(cleanupAttempts).toBe(2);
  });

  test("serializes live model updates in selection order", async () => {
    const harness = await createHarness();
    const startedModels: string[] = [];
    let releaseFirstUpdate: (() => void) | undefined;
    const firstUpdateReleased = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let markFirstUpdateStarted: (() => void) | undefined;
    const firstUpdateStarted = new Promise<void>((resolve) => {
      markFirstUpdateStarted = resolve;
    });
    harness.setUpdateSessionModel((input) =>
      Effect.promise(async () => {
        startedModels.push(input.model?.modelId ?? "default");
        if (startedModels.length === 1) {
          markFirstUpdateStarted?.();
          await firstUpdateReleased;
        }
      }),
    );
    const controlRef = {
      repoPath: "/repo",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
    };

    const firstUpdate = Effect.runPromise(
      harness.adapter.updateSessionModel({
        ...controlRef,
        model: {
          runtimeKind: "claude",
          providerId: "claude",
          modelId: "claude-a",
        },
      }),
    );
    await firstUpdateStarted;
    const secondUpdate = Effect.runPromise(
      harness.adapter.updateSessionModel({
        ...controlRef,
        model: {
          runtimeKind: "claude",
          providerId: "claude",
          modelId: "claude-b",
        },
      }),
    );
    await Promise.resolve();

    expect(startedModels).toEqual(["claude-a"]);

    releaseFirstUpdate?.();
    await Promise.all([firstUpdate, secondUpdate]);
    expect(startedModels).toEqual(["claude-a", "claude-b"]);
  });
});
