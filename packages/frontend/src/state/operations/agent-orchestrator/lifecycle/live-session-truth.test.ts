import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  type LiveSessionTruth,
  toLiveSessionTruthFromSnapshot,
  toPersistedOnlyLiveSessionTruth,
} from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  applyLiveSessionTruthToSession,
  createLiveSessionTruthReader,
  isAttachableLiveSessionTruth,
} from "./live-session-truth";

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

describe("live-session-truth", () => {
  test("classifies missing runtime as persisted-only without reading live snapshots", async () => {
    let truthReads = 0;
    const readTruth = createLiveSessionTruthReader({
      repoPath: "/tmp/repo",
      resolveHydrationRuntime: async () => ({
        ok: false,
        runtimeKind: "opencode",
        reason: "No live repo runtime found.",
      }),
      readTruth: async () => {
        truthReads += 1;
        return toPersistedOnlyLiveSessionTruth({
          ref: sessionRefFixture,
          reason: "No live repo runtime found.",
        });
      },
    });

    const truth = await readTruth(recordFixture);

    expect(truth.type).toBe("persisted_only");
    expect(truth.classification).toBe("persisted_only");
    expect(truthReads).toBe(0);
  });

  test("classifies missing live session as stale and clears pending input when applied", () => {
    const truth = toLiveSessionTruthFromSnapshot({
      ref: sessionRefFixture,
      runtimeId: "runtime-1",
      snapshot: null,
    });

    const applied = applyLiveSessionTruthToSession(createSessionState(), truth);

    expect(truth.classification).toBe("stale");
    expect(applied.status).toBe("idle");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("uses live pending input instead of persisted recovery hints", () => {
    const liveApproval = {
      requestId: "live-approval",
    } as AgentSessionState["pendingApprovals"][number];
    const truth = toLiveSessionTruthFromSnapshot({
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

    const applied = applyLiveSessionTruthToSession(createSessionState(), truth);

    expect(truth.classification).toBe("waiting_for_permission");
    expect(applied.pendingApprovals).toEqual([liveApproval]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("maps retry truth to running session status without pending input", () => {
    const truth = toLiveSessionTruthFromSnapshot({
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

    const applied = applyLiveSessionTruthToSession(createSessionState({ status: "idle" }), truth);

    expect(truth.type).toBe("live");
    expect(truth.classification).toBe("retrying");
    if (truth.type !== "live") {
      throw new Error("Expected live truth.");
    }
    expect(truth.agentSessionStatus).toBe("running");
    expect(applied.status).toBe("running");
    expect(applied.pendingApprovals).toEqual([]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("treats pending input and non-idle runtime status as attachable", () => {
    const createTruth = (overrides: Partial<LiveSessionTruth> = {}) =>
      toLiveSessionTruthFromSnapshot({
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

    const idleTruth = createTruth();
    const busyTruth = createTruth({ status: { type: "busy" } as never });
    const questionTruth = createTruth({
      pendingQuestions: [
        { requestId: "question-1" } as AgentSessionState["pendingQuestions"][number],
      ] as never,
    });

    expect(isAttachableLiveSessionTruth(idleTruth)).toBe(false);
    expect(isAttachableLiveSessionTruth(busyTruth)).toBe(true);
    expect(isAttachableLiveSessionTruth(questionTruth)).toBe(true);
  });
});
