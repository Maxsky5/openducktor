import { initialSpeedState } from "@openducktor/core";
import { SessionTurnAdmission } from "@openducktor/core";
import { describe, expect, mock, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { scheduleClaudeLiveContextUsageRefresh } from "./claude-agent-sdk-context-usage";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import {
  createClaudeContextUsageResponse,
  createClaudeQueryFixture,
} from "./claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";

const createSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession => ({
  turnAdmission: new SessionTurnAdmission(),
  acceptedUserMessages: [],
  activeSdkUserTurnCount: 0,
  abortController: new AbortController(),
  activity: "idle",
  externalSessionId: "session-1",
  input: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    systemPrompt: "Build",
  },
  model: undefined,
  pendingApprovals: new Map(),
  pendingQuestions: new Map(),
  queuedSdkMessages: [],
  pendingUserTurnCount: 0,
  query: createClaudeQueryFixture({
    close: mock(() => {}),
  }),
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-1",
  startedAt: "2026-06-25T20:00:00.000Z",
  summary: {
    speed: initialSpeedState("standard", "confirmed"),
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    startedAt: "2026-06-25T20:00:00.000Z",
    status: "idle",
  },
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
  ...overrides,
});

describe("createClaudeAgentSdkSessionStore", () => {
  test("stops and probes live Claude sessions without the service object", async () => {
    const events: unknown[] = [];
    const store = createClaudeAgentSdkSessionStore({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const session = createSession({
      activity: "running",
      activeSdkUserTurnCount: 1,
      pendingUserTurnCount: 1,
      sdkState: "running",
    });
    store.set(session);

    await expect(
      Effect.runPromise(
        store.probeSessionStatus({
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });

    await expect(
      Effect.runPromise(
        store.stopSession({
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(store.get("session-1")).toBeUndefined();
    expect(session.query.close).toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_finished",
        externalSessionId: "session-1",
      }),
    ]);
  });

  test("retracts queued user messages when stopping a session", async () => {
    const events: unknown[] = [];
    const store = createClaudeAgentSdkSessionStore({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const queuedMessage = {
      type: "user",
      uuid: "f9fc2054-d124-49cd-8ce4-ce02b316b672",
      message: { role: "user", content: [{ type: "text", text: "continue" }] },
      session_id: "session-1",
      parent_tool_use_id: null,
    } satisfies SDKUserMessage;
    const session = createSession({
      pendingUserTurnCount: 1,
      queuedSdkMessages: [queuedMessage],
    });
    store.set(session);

    await Effect.runPromise(
      store.stopSession({
        runtimeKind: "claude",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      }),
    );

    expect(events).toEqual([
      {
        type: "transcript_retracted",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        messageIds: ["f9fc2054-d124-49cd-8ce4-ce02b316b672"],
      },
      expect.objectContaining({
        type: "session_finished",
        externalSessionId: "session-1",
      }),
    ]);
  });

  test("notifies lifecycle listeners whenever a session is closed", async () => {
    const store = createClaudeAgentSdkSessionStore();
    const closedSessionIds: string[] = [];
    const unsubscribe = store.subscribeClose((session) =>
      closedSessionIds.push(session.externalSessionId),
    );
    const session = createSession();
    store.set(session);

    store.close(session);
    unsubscribe();

    expect(closedSessionIds).toEqual(["session-1"]);
  });

  test("keeps the replacement registered when the replaced session closes", () => {
    const store = createClaudeAgentSdkSessionStore();
    const replaced = createSession();
    const replacement = createSession();
    store.set(replaced);
    store.set(replacement);

    store.close(replaced);

    expect(replaced.query.close).toHaveBeenCalled();
    expect(store.get("session-1")).toBe(replacement);
  });

  test("does not report idle Claude sessions as live work for reset guards", async () => {
    const store = createClaudeAgentSdkSessionStore();
    store.set(
      createSession({
        activity: "idle",
        activeSdkUserTurnCount: 0,
        pendingUserTurnCount: 0,
        queuedSdkMessages: [],
        sdkState: "idle",
      }),
    );

    await expect(
      Effect.runPromise(
        store.probeSessionStatus({
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
  });

  test("reports Claude sessions with pending live work as active", async () => {
    const store = createClaudeAgentSdkSessionStore();
    const queuedMessage = {
      type: "user",
      uuid: "f9fc2054-d124-49cd-8ce4-ce02b316b672",
      message: { role: "user", content: [{ type: "text", text: "continue" }] },
      session_id: "session-1",
      parent_tool_use_id: null,
    } satisfies SDKUserMessage;
    store.set(
      createSession({
        activity: "idle",
        activeSdkUserTurnCount: 0,
        pendingUserTurnCount: 1,
        queuedSdkMessages: [queuedMessage],
        sdkState: "idle",
      }),
    );

    await expect(
      Effect.runPromise(
        store.probeSessionStatus({
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });
  });

  test("reports an ordinary background tool as live until it ends", async () => {
    const store = createClaudeAgentSdkSessionStore();
    const session = createSession({
      activity: "idle",
      sdkState: "idle",
      backgroundToolActiveTaskIds: new Set(["bash-task"]),
    });
    store.set(session);
    const probe = () =>
      Effect.runPromise(
        store.probeSessionStatus({
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      );

    await expect(probe()).resolves.toEqual({ supported: true, hasLiveSession: true });
    session.backgroundToolActiveTaskIds?.clear();
    await expect(probe()).resolves.toEqual({ supported: true, hasLiveSession: false });
  });

  test("reports an ordinary background tool in a child session as live", async () => {
    const store = createClaudeAgentSdkSessionStore();
    const child = createSession({ backgroundToolActiveTaskIds: new Set(["workflow-task"]) });
    store.set(
      Object.assign(
        createSession({
          activity: "idle",
          sdkState: "idle",
        }),
        { subagentEventSessionsByToolUseId: new Map([["agent-tool", child]]) },
      ),
    );

    await expect(
      Effect.runPromise(
        store.probeSessionStatus({
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });
  });

  test("does not report a background subagent as parent session work", async () => {
    const store = createClaudeAgentSdkSessionStore();
    store.set(
      createSession({
        activeBackgroundSubagentTaskIds: new Set(["task-1"]),
        activity: "idle",
        sdkState: "idle",
      }),
    );

    await expect(
      Effect.runPromise(
        store.probeSessionStatus({
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
  });

  test("does not report a nested background subagent as parent session work", async () => {
    const store = createClaudeAgentSdkSessionStore();
    const session = Object.assign(
      createSession({
        activity: "idle",
        sdkState: "idle",
      }),
      {
        subagentEventSessionsByToolUseId: new Map([
          [
            "outer-agent-tool",
            {
              activeBackgroundSubagentTaskIds: new Set(["nested-task"]),
            },
          ],
        ]),
      },
    );
    store.set(session);

    await expect(
      Effect.runPromise(
        store.probeSessionStatus({
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: false });
  });

  test("emits terminal events when stopping every session for a runtime", async () => {
    const events: unknown[] = [];
    const store = createClaudeAgentSdkSessionStore({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const firstSession = createSession({
      externalSessionId: "session-1",
      runtimeId: "runtime-1",
    });
    const secondSession = createSession({
      externalSessionId: "session-2",
      runtimeId: "runtime-1",
    });
    const otherRuntimeSession = createSession({
      externalSessionId: "session-3",
      runtimeId: "runtime-2",
    });
    store.set(firstSession);
    store.set(secondSession);
    store.set(otherRuntimeSession);

    await expect(
      Effect.runPromise(store.stopSessionsForRuntime("runtime-1")),
    ).resolves.toBeUndefined();

    expect(store.get("session-1")).toBeUndefined();
    expect(store.get("session-2")).toBeUndefined();
    expect(store.get("session-3")).toBe(otherRuntimeSession);
    expect(firstSession.query.close).toHaveBeenCalled();
    expect(secondSession.query.close).toHaveBeenCalled();
    expect(otherRuntimeSession.query.close).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_finished",
        externalSessionId: "session-1",
        message: "Runtime stopped",
      }),
      expect.objectContaining({
        type: "session_finished",
        externalSessionId: "session-2",
        message: "Runtime stopped",
      }),
    ]);
  });

  test("rejects pending approvals before closing a runtime session", async () => {
    const store = createClaudeAgentSdkSessionStore();
    const resolvedApprovals: unknown[] = [];
    const session = createSession({
      pendingApprovals: new Map([
        [
          "approval-1",
          {
            event: {
              type: "approval_required",
              externalSessionId: "session-1",
              timestamp: "2026-06-25T20:00:00.000Z",
              requestId: "approval-1",
              requestType: "command_execution",
              title: "Approve Bash",
              tool: { name: "Bash", input: { command: "pnpm test" } },
              mutation: "mutating",
            },
            resolve: (result) => {
              resolvedApprovals.push(result);
            },
          },
        ],
      ]),
    });
    store.set(session);

    await expect(
      Effect.runPromise(store.stopSessionsForRuntime("runtime-1")),
    ).resolves.toBeUndefined();

    expect(resolvedApprovals).toEqual([
      {
        behavior: "deny",
        interrupt: true,
        message: "Claude session was stopped.",
      },
    ]);
    expect(session.pendingApprovals.size).toBe(0);
  });

  test("drains live context refreshes before finishing runtime shutdown", async () => {
    const contextRead =
      Promise.withResolvers<ReturnType<typeof createClaudeContextUsageResponse>>();
    const queryClosed = Promise.withResolvers<void>();
    const events: Array<{ type: string }> = [];
    const backgroundFailures: unknown[] = [];
    const store = createClaudeAgentSdkSessionStore({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const session = createSession({
      query: createClaudeQueryFixture({
        close: mock(() => queryClosed.resolve()),
        getContextUsage: () => contextRead.promise,
      }),
    });
    store.set(session);
    scheduleClaudeLiveContextUsageRefresh({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: (failure) =>
        Effect.sync(() => {
          backgroundFailures.push(failure);
        }),
    });

    const stopPromise = Effect.runPromise(store.stopSessionsForRuntime("runtime-1"));
    await queryClosed.promise;
    expect(events).toEqual([]);

    contextRead.resolve(createClaudeContextUsageResponse(95_000, 200_000));
    await stopPromise;

    expect(events.map((event) => event.type)).toEqual([
      "session_context_updated",
      "session_finished",
    ]);
    expect(backgroundFailures).toEqual([]);
  });

  test("drains live context refreshes before finishing an individual stop", async () => {
    const contextRead =
      Promise.withResolvers<ReturnType<typeof createClaudeContextUsageResponse>>();
    const queryClosed = Promise.withResolvers<void>();
    const events: Array<{ type: string }> = [];
    const store = createClaudeAgentSdkSessionStore({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:00.000Z",
    });
    const session = createSession({
      query: createClaudeQueryFixture({
        close: mock(() => queryClosed.resolve()),
        getContextUsage: () => contextRead.promise,
      }),
    });
    store.set(session);
    scheduleClaudeLiveContextUsageRefresh({
      session,
      timestamp: "2026-06-25T20:00:01.000Z",
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: () => Effect.void,
    });

    const stopPromise = Effect.runPromise(
      store.stopSession({
        runtimeKind: "claude",
        workingDirectory: "/repo",
        externalSessionId: "session-1",
      }),
    );
    await queryClosed.promise;
    expect(events).toEqual([]);

    contextRead.resolve(createClaudeContextUsageResponse(95_000, 200_000));
    await stopPromise;

    expect(events.map((event) => event.type)).toEqual([
      "session_context_updated",
      "session_finished",
    ]);
  });

  test("aborts pending questions before closing a runtime session", async () => {
    const store = createClaudeAgentSdkSessionStore();
    let resolveAbort!: (value: string) => void;
    const aborted = new Promise<string>((resolve) => {
      resolveAbort = resolve;
    });
    const session = createSession({
      activeSdkUserTurnCount: 1,
      activity: "running",
      pendingUserTurnCount: 1,
      queuedSdkMessages: [
        {
          type: "user",
          message: { role: "user", content: "queued" },
          parent_tool_use_id: null,
        } satisfies SDKUserMessage,
      ],
    });
    session.abortController.signal.addEventListener(
      "abort",
      () => {
        session.pendingQuestions.delete("question-1");
        resolveAbort("aborted");
      },
      { once: true },
    );
    session.pendingQuestions.set("question-1", {
      event: {
        type: "question_required",
        externalSessionId: "session-1",
        timestamp: "2026-06-25T20:00:00.000Z",
        requestId: "question-1",
        questions: [
          {
            header: "Answer",
            options: [{ label: "OK", description: "Continue" }],
            question: "Answer?",
          },
        ],
      },
      resolve: () => {},
    });
    store.set(session);

    await expect(
      Effect.runPromise(store.stopSessionsForRuntime("runtime-1")),
    ).resolves.toBeUndefined();

    await expect(aborted).resolves.toBe("aborted");
    expect(session.activity).toBe("stopped");
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.queuedSdkMessages).toEqual([]);
    expect(session.pendingQuestions.size).toBe(0);
    expect(session.query.close).toHaveBeenCalled();
  });

  describe("with sessions from two repositories", () => {
    const createOtherRepositorySession = (overrides: Partial<ClaudeSession> = {}) => {
      const base = createSession();
      return createSession({
        externalSessionId: "session-2",
        input: { ...base.input, repoPath: "/other-repo", workingDirectory: "/other-repo/wt" },
        summary: {
          ...base.summary,
          externalSessionId: "session-2",
          workingDirectory: "/other-repo/wt",
        },
        query: createClaudeQueryFixture({ close: mock(() => {}) }),
        ...overrides,
      });
    };

    test("stops a session by kind, id, and working directory without a repository", async () => {
      const finished: string[] = [];
      const store = createClaudeAgentSdkSessionStore({
        emit: (session, event) => {
          if (event.type === "session_finished") {
            finished.push(`${session.input.repoPath}:${event.externalSessionId}`);
          }
        },
      });
      const repoSession = createSession({ activity: "running", sdkState: "running" });
      const otherSession = createOtherRepositorySession({
        activity: "running",
        sdkState: "running",
      });
      store.set(repoSession);
      store.set(otherSession);
      const otherTarget = {
        runtimeKind: "claude" as const,
        workingDirectory: "/other-repo/wt/",
        externalSessionId: "session-2",
      };

      await expect(Effect.runPromise(store.probeSessionStatus(otherTarget))).resolves.toEqual({
        supported: true,
        hasLiveSession: true,
      });
      await Effect.runPromise(store.stopSession(otherTarget));

      expect(finished).toEqual(["/other-repo:session-2"]);
      expect(store.get("session-2")).toBeUndefined();
      expect(store.get("session-1")).toBe(repoSession);
      expect(repoSession.query.close).not.toHaveBeenCalled();
    });

    test("rejects a stop target from another working directory", async () => {
      const store = createClaudeAgentSdkSessionStore();
      const otherSession = createOtherRepositorySession({ activity: "running" });
      store.set(otherSession);
      const target = {
        runtimeKind: "claude" as const,
        workingDirectory: "/repo",
        externalSessionId: "session-2",
      };

      await expect(Effect.runPromise(store.probeSessionStatus(target))).resolves.toEqual({
        supported: true,
        hasLiveSession: false,
      });
      await expect(Effect.runPromise(store.stopSession(target))).rejects.toThrow(
        "Cannot stop claude session 'session-2' in working directory '/repo' because the registered Claude session uses working directory '/other-repo/wt'.",
      );
      expect(store.get("session-2")).toBe(otherSession);
    });

    test("releases the sessions of every repository owned by the runtime", async () => {
      const finished: string[] = [];
      const store = createClaudeAgentSdkSessionStore({
        emit: (session, event) => {
          if (event.type === "session_finished") {
            finished.push(`${session.input.repoPath}:${event.externalSessionId}`);
          }
        },
      });
      const denied: string[] = [];
      const repoSession = createSession();
      const otherSession = createOtherRepositorySession();
      otherSession.pendingApprovals.set("approval-1", {
        event: {
          type: "approval_required",
          externalSessionId: "session-2",
          timestamp: "2026-06-25T20:00:00.000Z",
          requestId: "approval-1",
          requestType: "command_execution",
          title: "Run command",
        },
        resolve: (result) => denied.push(result.behavior),
      });
      const replacementSession = createSession({
        externalSessionId: "session-3",
        runtimeId: "runtime-2",
        query: createClaudeQueryFixture({ close: mock(() => {}) }),
      });
      store.set(repoSession);
      store.set(otherSession);
      store.set(replacementSession);

      await Effect.runPromise(store.stopSessionsForRuntime("runtime-1"));

      expect(finished).toEqual(["/repo:session-1", "/other-repo:session-2"]);
      expect(denied).toEqual(["deny"]);
      expect(otherSession.pendingApprovals.size).toBe(0);
      expect([...store.values()]).toEqual([replacementSession]);
      expect(replacementSession.query.close).not.toHaveBeenCalled();
    });
  });
});
