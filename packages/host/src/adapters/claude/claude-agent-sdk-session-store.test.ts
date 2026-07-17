import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";

const createSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession => ({
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
  query: {
    close: mock(() => {}),
  } as unknown as ClaudeSession["query"],
  queue: new AsyncInputQueue(),
  runtimeId: "runtime-1",
  startedAt: "2026-06-25T20:00:00.000Z",
  summary: {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo",
    role: "build",
    startedAt: "2026-06-25T20:00:00.000Z",
    status: "idle",
  },
  streamAssistantMessageOrdinal: 0,
  streamAssistantMessageIdsByBlockIndex: new Map(),
  subagentMessageIdsByTaskId: new Map(),
  subagentTaskIdsByToolUseId: new Map(),
  toolInputsByCallId: new Map(),
  toolMessageIdsByCallId: new Map(),
  toolNamesByCallId: new Map(),
  toolStartedAtMsByCallId: new Map(),
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
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });

    await expect(
      Effect.runPromise(
        store.stopSession({
          repoPath: "/repo",
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
          repoPath: "/repo",
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
      uuid: "queued-1",
      message: { role: "user", content: [{ type: "text", text: "continue" }] },
      session_id: "session-1",
      parent_tool_use_id: null,
    } as unknown as ClaudeSession["queuedSdkMessages"][number];
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
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
        }),
      ),
    ).resolves.toEqual({ supported: true, hasLiveSession: true });
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
        } as never,
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
});
