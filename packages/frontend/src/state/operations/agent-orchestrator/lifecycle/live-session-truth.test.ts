import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { LiveAgentSessionSnapshot } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  applyLiveSessionTruthToSession,
  createLiveSessionTruthReader,
  isAttachableLiveSessionTruth,
  toLiveSessionTruthFromResolvedSnapshot,
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

const createSnapshot = (
  overrides: Partial<LiveAgentSessionSnapshot> = {},
): LiveAgentSessionSnapshot => ({
  externalSessionId: "external-1",
  title: " Builder Session ",
  startedAt: "2026-03-01T09:00:00.000Z",
  status: { type: "idle" },
  pendingApprovals: [],
  pendingQuestions: [],
  workingDirectory: "/tmp/repo/worktree",
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
    let snapshotReads = 0;
    const readTruth = createLiveSessionTruthReader({
      repoPath: "/tmp/repo",
      resolveHydrationRuntime: async () => ({
        ok: false,
        runtimeKind: "opencode",
        reason: "No live repo runtime found.",
      }),
      readSnapshot: async () => {
        snapshotReads += 1;
        return null;
      },
    });

    const truth = await readTruth(recordFixture);

    expect(truth.type).toBe("missing_runtime");
    expect(truth.classification).toBe("persisted_only");
    expect(snapshotReads).toBe(0);
  });

  test("classifies missing live session as stale and clears pending input when applied", () => {
    const truth = toLiveSessionTruthFromResolvedSnapshot({
      sessionRef: sessionRefFixture,
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
    const truth = toLiveSessionTruthFromResolvedSnapshot({
      sessionRef: sessionRefFixture,
      runtimeId: "runtime-1",
      snapshot: createSnapshot({ pendingApprovals: [liveApproval] }),
    });

    const applied = applyLiveSessionTruthToSession(createSessionState(), truth);

    expect(truth.classification).toBe("waiting_for_permission");
    expect(applied.pendingApprovals).toEqual([liveApproval]);
    expect(applied.pendingQuestions).toEqual([]);
  });

  test("maps retry truth to running session status without pending input", () => {
    const truth = toLiveSessionTruthFromResolvedSnapshot({
      sessionRef: sessionRefFixture,
      runtimeId: "runtime-1",
      snapshot: createSnapshot({
        status: { type: "retry", attempt: 2, message: "try again", nextEpochMs: 1234 },
      }),
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
    const idleTruth = toLiveSessionTruthFromResolvedSnapshot({
      sessionRef: sessionRefFixture,
      runtimeId: "runtime-1",
      snapshot: createSnapshot(),
    });
    const busyTruth = toLiveSessionTruthFromResolvedSnapshot({
      sessionRef: sessionRefFixture,
      runtimeId: "runtime-1",
      snapshot: createSnapshot({ status: { type: "busy" } }),
    });
    const questionTruth = toLiveSessionTruthFromResolvedSnapshot({
      sessionRef: sessionRefFixture,
      runtimeId: "runtime-1",
      snapshot: createSnapshot({
        pendingQuestions: [
          { requestId: "question-1" } as AgentSessionState["pendingQuestions"][number],
        ],
      }),
    });

    expect(isAttachableLiveSessionTruth(idleTruth)).toBe(false);
    expect(isAttachableLiveSessionTruth(busyTruth)).toBe(true);
    expect(isAttachableLiveSessionTruth(questionTruth)).toBe(true);
  });
});
