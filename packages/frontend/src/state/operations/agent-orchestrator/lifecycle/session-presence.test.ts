import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  type AgentSessionPresenceSnapshot,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
  toPersistedOnlyAgentSessionPresenceSnapshot,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  applyAgentSessionPresenceSnapshotToSession,
  createSessionPresenceReader,
  isAttachableAgentSessionPresenceSnapshot,
} from "./session-presence";

const recordFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  selectedModel: null,
};

const createSessionState = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: "/tmp/repo",
  role: "build",
  status: "running",
  startedAt: "2026-03-01T09:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: "runtime-1",
  workingDirectory: "/tmp/repo/worktree",
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
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
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
  test("classifies missing runtime as persisted-only without reading live snapshots", async () => {
    let snapshotReads = 0;
    const readPresence = createSessionPresenceReader({
      repoPath: "/tmp/repo",
      resolveHydrationRuntime: async () => ({
        ok: false,
        runtimeKind: "opencode",
        reason: "No live repo runtime found.",
      }),
      readPresence: async () => {
        snapshotReads += 1;
        return toPersistedOnlyAgentSessionPresenceSnapshot({
          ref: sessionRefFixture,
          reason: "No live repo runtime found.",
        });
      },
    });

    const snapshot = await readPresence(recordFixture);

    expect(snapshot.presence).toBe("persisted_only");
    expect(snapshot.classification).toBe("persisted_only");
    expect(snapshotReads).toBe(0);
  });

  test("classifies missing live session as stale and clears pending input when applied", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      runtimeId: "runtime-1",
      snapshot: null,
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(createSessionState(), snapshot);

    expect(snapshot.classification).toBe("stale");
    expect(applied.status).toBe("idle");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("keeps pending outbound sends running when stale presence arrives", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      runtimeId: "runtime-1",
      snapshot: null,
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({ pendingUserMessageStartedAt: 123 }),
      snapshot,
    );

    expect(applied.status).toBe("running");
    expect(applied.runtimeRecoveryState).toBe("recovering_runtime");
  });

  test("keeps pending outbound sends running when idle presence arrives", () => {
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      runtimeId: "runtime-1",
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

    expect(applied.status).toBe("running");
  });

  test("marks persisted-only pending outbound sends as recovering runtime", () => {
    const snapshot = toPersistedOnlyAgentSessionPresenceSnapshot({
      ref: sessionRefFixture,
      reason: "No live repo runtime found.",
    });

    const applied = applyAgentSessionPresenceSnapshotToSession(
      createSessionState({ pendingUserMessageStartedAt: 123 }),
      snapshot,
    );

    expect(applied.status).toBe("running");
    expect(applied.runtimeRecoveryState).toBe("recovering_runtime");
    expect(applied.runtimeId).toBeNull();
  });

  test("uses live pending input instead of persisted recovery hints", () => {
    const liveApproval = {
      requestId: "live-approval",
    } as AgentSessionState["pendingApprovals"][number];
    const snapshot = toAgentSessionPresenceSnapshotFromLiveSnapshot({
      ref: sessionRefFixture,
      runtimeId: "runtime-1",
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
      runtimeId: "runtime-1",
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

  test("treats pending input and non-idle runtime status as attachable", () => {
    const createPresence = (overrides: Partial<AgentSessionPresenceSnapshot> = {}) =>
      toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: sessionRefFixture,
        runtimeId: "runtime-1",
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

    expect(isAttachableAgentSessionPresenceSnapshot(idlePresence)).toBe(false);
    expect(isAttachableAgentSessionPresenceSnapshot(busyPresence)).toBe(true);
    expect(isAttachableAgentSessionPresenceSnapshot(questionPresence)).toBe(true);
  });
});
