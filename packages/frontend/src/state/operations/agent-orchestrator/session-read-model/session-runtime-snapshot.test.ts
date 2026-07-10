import { describe, expect, test } from "bun:test";
import {
  toAgentSessionRuntimeSnapshot,
  toMissingAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import {
  applyRuntimeSnapshotToSession,
  shouldObserveAgentSessionRuntimeSnapshot,
} from "./session-runtime-snapshot";

type CreateSessionStateOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
};

const createSessionState = (overrides: CreateSessionStateOverrides = {}): AgentSessionState => {
  const { messages, ...sessionOverrides } = overrides;
  const externalSessionId = sessionOverrides.externalSessionId ?? "external-1";

  return {
    externalSessionId,
    taskId: "task-1",
    role: "build",
    status: "running",
    startedAt: "2026-03-01T09:00:00.000Z",
    runtimeKind: "opencode",
    workingDirectory: "/tmp/repo/worktree",
    historyLoadState: sessionOverrides.historyLoadState ?? "not_requested",
    messages: createSessionMessagesFixture(externalSessionId, messages),
    contextUsage: null,
    pendingApprovals: [
      { requestId: "persisted-approval" } as AgentSessionState["pendingApprovals"][number],
    ],
    pendingQuestions: [
      { requestId: "persisted-question" } as AgentSessionState["pendingQuestions"][number],
    ],
    selectedModel: null,
    ...sessionOverrides,
  };
};

const sessionRefFixture = {
  repoPath: "/tmp/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/tmp/repo/worktree",
  externalSessionId: "external-1",
};

type RuntimeSnapshot = Parameters<typeof shouldObserveAgentSessionRuntimeSnapshot>[0];

const applyAvailableSnapshotToSession = (
  session: AgentSessionState,
  snapshot: RuntimeSnapshot,
): AgentSessionState => applyRuntimeSnapshotToSession(session, snapshot);

const applyMissingSnapshotToSession = (session: AgentSessionState): AgentSessionState =>
  applyRuntimeSnapshotToSession(session, toMissingAgentSessionRuntimeSnapshot(sessionRefFixture));

describe("session-runtime-snapshot", () => {
  test("settles runtime-owned fields when runtime snapshot is missing", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: null,
    });

    const session = createSessionState();
    const applied = applyRuntimeSnapshotToSession(session, snapshot);

    expect(snapshot.classification).toBe("missing");
    expect(applied.status).toBe("idle");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
    expect(applied.messages).toBe(session.messages);
  });

  test("clears pending outbound sends when runtime snapshot is missing", () => {
    const session = createSessionState({
      pendingUserMessageStartedAt: 123,
      runtimeStatusMessage: "Safety buffering",
    });
    const applied = applyMissingSnapshotToSession(session);

    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(applied.runtimeStatusMessage).toBeNull();
  });

  test("settles untrusted runtime-owned state when runtime snapshot is missing", () => {
    const session = createSessionState({
      historyLoadState: "loaded",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "already visible",
          timestamp: "2026-03-01T09:00:01.000Z",
        },
      ],
      pendingUserMessageStartedAt: 123,
    });

    const applied = applyMissingSnapshotToSession(session);

    expect(applied.status).toBe("idle");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(applied.historyLoadState).toBe("loaded");
    expect(applied.messages).toBe(session.messages);
  });

  test("trusts idle runtime snapshot and settles locally pending outbound sends", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(
      createSessionState({
        pendingApprovals: [],
        pendingQuestions: [],
        pendingUserMessageStartedAt: 123,
        runtimeStatusMessage: "Safety buffering",
      }),
      snapshot,
    );

    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(applied.runtimeStatusMessage).toBeNull();
  });

  test("reuses empty pending input arrays from the current session", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });
    const session = createSessionState({
      title: " Builder Session ",
      pendingApprovals: [],
      pendingQuestions: [],
    });

    const applied = applyAvailableSnapshotToSession(session, snapshot);

    expect(applied.pendingApprovals).toBe(session.pendingApprovals);
    expect(applied.pendingQuestions).toBe(session.pendingQuestions);
  });

  test("keeps session identity owned by the current session when applying a runtime snapshot", () => {
    const session = createSessionState({
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    });
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: {
        ...sessionRefFixture,
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/normalized-worktree",
      },
      snapshot: {
        title: " Live title ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(session, snapshot);

    expect(applied.runtimeKind).toBe("opencode");
    expect(applied.workingDirectory).toBe("/tmp/repo/worktree");
    expect(applied.title).toBe(" Live title ");
    expect(applied.status).toBe("running");
  });

  test("keeps a starting session starting when runtime is idle before the send starts", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(
      createSessionState({ status: "starting" }),
      snapshot,
    );

    expect(applied.status).toBe("starting");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("lets a non-idle runtime snapshot move a starting session to running", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(
      createSessionState({ status: "starting" }),
      snapshot,
    );

    expect(applied.status).toBe("running");
  });

  test("keeps pending outbound sends running when runtime snapshot is busy", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "running",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(
      createSessionState({
        pendingUserMessageStartedAt: 123,
      }),
      snapshot,
    );

    expect(applied.status).toBe("running");
    expect(applied.pendingUserMessageStartedAt).toBe(123);
  });

  test("settles pending outbound sends and surfaces idle status when runtime reports pending input", () => {
    const liveApproval = {
      requestId: "live-approval",
    } as AgentSessionState["pendingApprovals"][number];
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "idle",
        pendingApprovals: [liveApproval],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(
      createSessionState({
        pendingUserMessageStartedAt: 123,
      }),
      snapshot,
    );

    expect(snapshot.classification).toBe("waiting_for_permission");
    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(applied.pendingApprovals).toEqual([liveApproval]);
  });

  test("settles mounted running state when no runtime snapshot exists", () => {
    const snapshot = toMissingAgentSessionRuntimeSnapshot(sessionRefFixture);

    const applied = applyMissingSnapshotToSession(
      createSessionState({ pendingUserMessageStartedAt: 123 }),
    );

    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
    expect(shouldObserveAgentSessionRuntimeSnapshot(snapshot)).toBe(false);
  });

  test("settles fresh records without mounted live state", () => {
    const applied = applyMissingSnapshotToSession(
      createSessionState({
        status: "stopped",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    );

    expect(applied.status).toBe("stopped");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("preserves terminal status without runtime snapshot", () => {
    expect(applyMissingSnapshotToSession(createSessionState({ status: "stopped" })).status).toBe(
      "stopped",
    );
    expect(applyMissingSnapshotToSession(createSessionState({ status: "error" })).status).toBe(
      "error",
    );
  });

  test("preserves session identity when runtime snapshot is missing", () => {
    const applied = applyMissingSnapshotToSession(
      createSessionState({
        runtimeKind: "codex",
        workingDirectory: "/tmp/repo/codex-worktree",
      }),
    );

    expect(applied.runtimeKind).toBe("codex");
    expect(applied.workingDirectory).toBe("/tmp/repo/codex-worktree");
    expect(applied.status).toBe("idle");
  });

  test("uses live pending input instead of persisted recovery hints", () => {
    const liveApproval = {
      requestId: "live-approval",
    } as AgentSessionState["pendingApprovals"][number];
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "idle",
        pendingApprovals: [liveApproval],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(createSessionState(), snapshot);

    expect(snapshot.classification).toBe("waiting_for_permission");
    expect(applied.pendingApprovals).toEqual([liveApproval]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("maps retry snapshot to running session status without pending input", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "retrying",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(
      createSessionState({ status: "idle" }),
      snapshot,
    );

    expect(snapshot.availability).toBe("runtime");
    expect(snapshot.classification).toBe("retrying");
    expect(applied.status).toBe("running");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("keeps pending outbound sends when runtime snapshot is retrying", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        runtimeActivity: "retrying",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });

    const applied = applyAvailableSnapshotToSession(
      createSessionState({
        status: "idle",
        pendingUserMessageStartedAt: 123,
      }),
      snapshot,
    );

    expect(applied.status).toBe("running");
    expect(applied.pendingUserMessageStartedAt).toBe(123);
  });

  test("treats pending input and non-idle runtime status for observation", () => {
    const createRuntimeSnapshot = (
      overrides: Partial<
        NonNullable<Parameters<typeof toAgentSessionRuntimeSnapshot>[0]["snapshot"]>
      > = {},
    ) =>
      toAgentSessionRuntimeSnapshot({
        ref: sessionRefFixture,
        snapshot: {
          externalSessionId: "external-1",
          title: " Builder Session ",
          startedAt: "2026-03-01T09:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
          ...overrides,
        } as never,
      });

    const idleRuntimeSnapshot = createRuntimeSnapshot();
    const busyRuntimeSnapshot = createRuntimeSnapshot({ runtimeActivity: "running" });
    const questionRuntimeSnapshot = createRuntimeSnapshot({
      pendingQuestions: [
        { requestId: "question-1" } as AgentSessionState["pendingQuestions"][number],
      ] as never,
    });

    expect(shouldObserveAgentSessionRuntimeSnapshot(idleRuntimeSnapshot)).toBe(false);
    expect(shouldObserveAgentSessionRuntimeSnapshot(busyRuntimeSnapshot)).toBe(true);
    expect(shouldObserveAgentSessionRuntimeSnapshot(questionRuntimeSnapshot)).toBe(true);
  });

  test("settles runtime-owned state when runtime snapshot is missing", () => {
    const session = createSessionState({
      status: "running",
      pendingApprovals: [],
      pendingQuestions: [],
      pendingUserMessageStartedAt: 123,
    });
    const snapshot = toMissingAgentSessionRuntimeSnapshot(sessionRefFixture);

    const applied = applyMissingSnapshotToSession(session);

    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(shouldObserveAgentSessionRuntimeSnapshot(snapshot)).toBe(false);
  });

  test("keeps persisted idle state when runtime snapshot is missing", () => {
    const session = createSessionState({
      status: "idle",
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const snapshot = toMissingAgentSessionRuntimeSnapshot(sessionRefFixture);

    const applied = applyMissingSnapshotToSession(session);

    expect(applied.status).toBe("idle");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
    expect(shouldObserveAgentSessionRuntimeSnapshot(snapshot)).toBe(false);
  });
});
