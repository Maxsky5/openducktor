import { describe, expect, test } from "bun:test";
import {
  type AgentSessionPresenceSnapshot,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
  toPersistedOnlyAgentSessionPresenceSnapshot,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  applyAgentSessionPresenceSnapshotToSession,
  shouldListenToAgentSessionPresenceSnapshot,
} from "./session-presence";

const createSessionState = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  status: "running",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  historyLoadState: overrides.historyLoadState ?? "not_requested",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingApprovals: [
    { requestId: "persisted-approval" } as AgentSessionState["pendingApprovals"][number],
  ],
  pendingQuestions: [
    { requestId: "persisted-question" } as AgentSessionState["pendingQuestions"][number],
  ],
  selectedModel: null,
  promptOverrides: {},
  ...overrides,
});

const sessionRefFixture = {
  repoPath: "/tmp/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/tmp/repo/worktree",
  externalSessionId: "external-1",
};

describe("session-presence", () => {
  test("classifies missing live session as stale and demotes live-only state", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: null,
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(createSessionState(), snapshot);

    expect(snapshot.classification).toBe("stale");
    expect(applied.status).toBe("idle");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("settles pending outbound sends when stale presence arrives", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: null,
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({ pendingUserMessageStartedAt: 123 }),
      snapshot,
    );

    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
  });

  test("settles pending outbound sends and surfaces runtime idle status", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        externalSessionId: "external-1",
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        status: { type: "idle" },
        pendingApprovals: [],
        pendingQuestions: [],
        workingDirectory: "/tmp/repo/worktree",
      },
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({ pendingUserMessageStartedAt: 123 }),
      snapshot,
    );

    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(applied.draftAssistantText).toBe("");
    expect(applied.draftAssistantMessageId).toBeNull();
    expect(applied.draftReasoningText).toBe("");
    expect(applied.draftReasoningMessageId).toBeNull();
  });

  test("keeps a starting session starting when runtime is idle before the send starts", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        externalSessionId: "external-1",
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        status: { type: "idle" },
        pendingApprovals: [],
        pendingQuestions: [],
        workingDirectory: "/tmp/repo/worktree",
      },
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({ status: "starting" }),
      snapshot,
    );

    expect(applied.status).toBe("starting");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("keeps pending outbound sends running when runtime presence is busy", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        externalSessionId: "external-1",
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        status: { type: "busy" },
        pendingApprovals: [],
        pendingQuestions: [],
        workingDirectory: "/tmp/repo/worktree",
      },
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({
        pendingUserMessageStartedAt: 123,
        draftAssistantText: "partial assistant",
        draftAssistantMessageId: "assistant-draft",
      }),
      snapshot,
    );

    expect(applied.status).toBe("running");
    expect(applied.pendingUserMessageStartedAt).toBe(123);
    expect(applied.draftAssistantText).toBe("partial assistant");
    expect(applied.draftAssistantMessageId).toBe("assistant-draft");
  });

  test("settles pending outbound sends and surfaces idle status when runtime reports pending input", () => {
    const liveApproval = {
      requestId: "live-approval",
    } as AgentSessionState["pendingApprovals"][number];
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        externalSessionId: "external-1",
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        status: { type: "idle" },
        pendingApprovals: [liveApproval],
        pendingQuestions: [],
        workingDirectory: "/tmp/repo/worktree",
      },
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({
        pendingUserMessageStartedAt: 123,
        draftAssistantText: "partial assistant",
        draftAssistantMessageId: "assistant-draft",
      }),
      snapshot,
    );

    expect(snapshot.classification).toBe("waiting_for_permission");
    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(applied.draftAssistantText).toBe("");
    expect(applied.draftAssistantMessageId).toBeNull();
    expect(applied.pendingApprovals).toEqual([liveApproval]);
  });

  test("settles persisted-only pending outbound sends", () => {
    const snapshot = toPersistedOnlyAgentSessionPresenceSnapshot({
      ref: sessionRefFixture,
      reason: "No live repo runtime found.",
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({ pendingUserMessageStartedAt: 123 }),
      snapshot,
    );

    expect(applied.status).toBe("idle");
    expect(applied.pendingUserMessageStartedAt).toBeUndefined();
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("preserves terminal status without runtime presence", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: null,
    });

    expect(
      applyAgentSessionPresenceSnapshotToSession(
        createSessionState({ status: "stopped" }),
        snapshot,
      ).status,
    ).toBe("stopped");
    expect(
      applyAgentSessionPresenceSnapshotToSession(createSessionState({ status: "error" }), snapshot)
        .status,
    ).toBe("error");
  });

  test("uses live pending input instead of persisted recovery hints", () => {
    const liveApproval = {
      requestId: "live-approval",
    } as AgentSessionState["pendingApprovals"][number];
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        externalSessionId: "external-1",
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        status: { type: "idle" },
        pendingApprovals: [liveApproval],
        pendingQuestions: [],
        workingDirectory: "/tmp/repo/worktree",
      },
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(createSessionState(), snapshot);

    expect(snapshot.classification).toBe("waiting_for_permission");
    expect(applied.pendingApprovals).toEqual([liveApproval]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("maps retry snapshot to running session status without pending input", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        externalSessionId: "external-1",
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        status: { type: "retry", attempt: 2, message: "try again", nextEpochMs: 1234 },
        pendingApprovals: [],
        pendingQuestions: [],
        workingDirectory: "/tmp/repo/worktree",
      },
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({ status: "idle" }),
      snapshot,
    );

    expect(snapshot.presence).toBe("runtime");
    expect(snapshot.classification).toBe("retrying");
    if (snapshot.presence !== "runtime") {
      throw new Error("Expected live snapshot.");
    }
    expect(snapshot.agentSessionStatus).toBe("running");
    expect(applied.status).toBe("running");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("keeps pending outbound sends when runtime presence is retrying", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      snapshot: {
        externalSessionId: "external-1",
        title: " Builder Session ",
        startedAt: "2026-03-01T09:00:00.000Z",
        status: { type: "retry", attempt: 2, message: "try again", nextEpochMs: 1234 },
        pendingApprovals: [],
        pendingQuestions: [],
        workingDirectory: "/tmp/repo/worktree",
      },
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({
        status: "idle",
        pendingUserMessageStartedAt: 123,
        draftAssistantText: "partial assistant",
        draftAssistantMessageId: "assistant-draft",
        draftReasoningText: "partial reasoning",
        draftReasoningMessageId: "reasoning-draft",
      }),
      snapshot,
    );

    if (snapshot.presence !== "runtime") {
      throw new Error("Expected live snapshot.");
    }
    expect(snapshot.agentSessionStatus).toBe("running");
    expect(applied.status).toBe("running");
    expect(applied.pendingUserMessageStartedAt).toBe(123);
    expect(applied.draftAssistantText).toBe("partial assistant");
    expect(applied.draftAssistantMessageId).toBe("assistant-draft");
    expect(applied.draftReasoningText).toBe("partial reasoning");
    expect(applied.draftReasoningMessageId).toBe("reasoning-draft");
  });

  test("treats pending input and non-idle runtime status for listening", () => {
    const createPresence = (overrides: Partial<AgentSessionPresenceSnapshot> = {}) =>
      toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: sessionRefFixture,
        snapshot: {
          externalSessionId: "external-1",
          title: " Builder Session ",
          startedAt: "2026-03-01T09:00:00.000Z",
          status: { type: "idle" },
          pendingApprovals: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
          ...overrides,
        } as never,
      });

    const idlePresence = createPresence();
    const busyPresence = createPresence({ status: { type: "busy" } as never });
    const questionPresence = createPresence({
      pendingQuestions: [
        { requestId: "question-1" } as AgentSessionState["pendingQuestions"][number],
      ] as never,
    });

    expect(shouldListenToAgentSessionPresenceSnapshot(idlePresence)).toBe(false);
    expect(shouldListenToAgentSessionPresenceSnapshot(busyPresence)).toBe(true);
    expect(shouldListenToAgentSessionPresenceSnapshot(questionPresence)).toBe(true);
  });
});
