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
  applyAgentSessionRuntimeSnapshotToSession,
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
    ...sessionOverrides,
  };
};

const sessionRefFixture = {
  repoPath: "/tmp/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/tmp/repo/worktree",
  externalSessionId: "external-1",
};

describe("session-runtime-snapshot", () => {
  test("classifies missing live session without rewriting local state", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: null,
    });

    const applied = applyAgentSessionRuntimeSnapshotToSession(createSessionState(), snapshot);

    expect(snapshot.classification).toBe("missing");
    expect(applied.status).toBe("running");
    expect(applied.pendingApprovals).toEqual(createSessionState().pendingApprovals);
    expect(applied.pendingQuestions).toEqual(createSessionState().pendingQuestions);
  });

  test("keeps pending outbound sends when runtime snapshot is missing", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: null,
    });

    const applied = applyAgentSessionRuntimeSnapshotToSession(
      createSessionState({ pendingUserMessageStartedAt: 123 }),
      snapshot,
    );

    expect(applied.status).toBe("running");
    expect(applied.pendingUserMessageStartedAt).toBe(123);
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

    const applied = applyAgentSessionRuntimeSnapshotToSession(
      createSessionState({
        pendingApprovals: [],
        pendingQuestions: [],
        pendingUserMessageStartedAt: 123,
      }),
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

    const applied = applyAgentSessionRuntimeSnapshotToSession(
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

    const applied = applyAgentSessionRuntimeSnapshotToSession(
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

    const applied = applyAgentSessionRuntimeSnapshotToSession(
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

    const applied = applyAgentSessionRuntimeSnapshotToSession(
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

  test("preserves non-terminal state when no runtime snapshot exists", () => {
    const snapshot = toMissingAgentSessionRuntimeSnapshot(sessionRefFixture);

    const applied = applyAgentSessionRuntimeSnapshotToSession(
      createSessionState({ pendingUserMessageStartedAt: 123 }),
      snapshot,
    );

    expect(applied.status).toBe("running");
    expect(applied.pendingUserMessageStartedAt).toBe(123);
    expect(applied.pendingApprovals).toEqual(createSessionState().pendingApprovals);
    expect(applied.pendingQuestions).toEqual(createSessionState().pendingQuestions);
  });

  test("settles fresh records without mounted live state", () => {
    const snapshot = toMissingAgentSessionRuntimeSnapshot(sessionRefFixture);

    const applied = applyAgentSessionRuntimeSnapshotToSession(
      createSessionState({
        status: "stopped",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
      snapshot,
    );

    expect(applied.status).toBe("stopped");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("preserves terminal status without runtime snapshot", () => {
    const snapshot = toAgentSessionRuntimeSnapshot({
      ref: sessionRefFixture,
      snapshot: null,
    });

    expect(
      applyAgentSessionRuntimeSnapshotToSession(createSessionState({ status: "stopped" }), snapshot)
        .status,
    ).toBe("stopped");
    expect(
      applyAgentSessionRuntimeSnapshotToSession(createSessionState({ status: "error" }), snapshot)
        .status,
    ).toBe("error");
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

    const applied = applyAgentSessionRuntimeSnapshotToSession(createSessionState(), snapshot);

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

    const applied = applyAgentSessionRuntimeSnapshotToSession(
      createSessionState({ status: "idle" }),
      snapshot,
    );

    expect(snapshot.availability).toBe("runtime");
    expect(snapshot.classification).toBe("retrying");
    if (snapshot.availability !== "runtime") {
      throw new Error("Expected runtime snapshot source.");
    }
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

    const applied = applyAgentSessionRuntimeSnapshotToSession(
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

    if (snapshot.availability !== "runtime") {
      throw new Error("Expected runtime snapshot source.");
    }
    expect(applied.status).toBe("running");
    expect(applied.pendingUserMessageStartedAt).toBe(123);
    expect(applied.draftAssistantText).toBe("partial assistant");
    expect(applied.draftAssistantMessageId).toBe("assistant-draft");
    expect(applied.draftReasoningText).toBe("partial reasoning");
    expect(applied.draftReasoningMessageId).toBe("reasoning-draft");
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

  test("preserves mounted runtime-owned state when runtime snapshot is missing", () => {
    const session = createSessionState({
      status: "running",
      pendingApprovals: [],
      pendingQuestions: [],
      pendingUserMessageStartedAt: 123,
      draftAssistantText: "partial assistant",
      draftAssistantMessageId: "assistant-draft",
    });
    const snapshot = toMissingAgentSessionRuntimeSnapshot(sessionRefFixture);

    const applied = applyAgentSessionRuntimeSnapshotToSession(session, snapshot);

    expect(applied.status).toBe("running");
    expect(applied.pendingUserMessageStartedAt).toBe(123);
    expect(applied.draftAssistantText).toBe("partial assistant");
    expect(applied.draftAssistantMessageId).toBe("assistant-draft");
    expect(shouldObserveAgentSessionRuntimeSnapshot(snapshot)).toBe(false);
  });

  test("settles mounted idle state when runtime snapshot is missing", () => {
    const session = createSessionState({
      status: "idle",
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const snapshot = toMissingAgentSessionRuntimeSnapshot(sessionRefFixture);

    const applied = applyAgentSessionRuntimeSnapshotToSession(session, snapshot);

    expect(applied.status).toBe("idle");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
    expect(shouldObserveAgentSessionRuntimeSnapshot(snapshot)).toBe(false);
  });
});
