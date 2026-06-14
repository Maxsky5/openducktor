import { describe, expect, test } from "bun:test";
import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import {
  createAgentSessionCollection,
  getAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { createSessionMessagesState } from "../support/messages";
import { loadSessionHistoryForReadModel } from "./session-history-read-model-loader";

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Implement feature",
  description: "Build the task from the repository rules.",
  status: "in_progress",
  priority: 1,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-06-12T08:00:00.000Z",
  createdAt: "2026-06-12T08:00:00.000Z",
};

const sessionRef = (externalSessionId: string): AgentSessionRef => ({
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId,
});

const createSession = (
  externalSessionId: string,
  historyLoadState: "not_requested" | "loaded" = "not_requested",
): ReturnType<typeof createAgentSessionFixture> => {
  const session = createAgentSessionFixture({
    externalSessionId,
    taskId: taskFixture.id,
    runtimeKind: "opencode",
    role: "build",
    status: "running",
    startedAt: "2026-06-12T08:00:00.000Z",
    workingDirectory: "/repo/worktree",
    historyLoadState,
  });
  return {
    ...session,
    messages: createSessionMessagesState(externalSessionId, []),
  };
};

const promptContext = {
  workspaceId: "workspace-1",
  taskCardsById: new Map([[taskFixture.id, taskFixture]]),
  loadRepoPromptOverrides: async (): Promise<RepoPromptOverrides> => ({}),
};

describe("loadSessionHistoryForReadModel", () => {
  test("loads history for live sessions that have not requested history yet", async () => {
    let sessionCollection = createAgentSessionCollection([
      createSession("external-1"),
      createSession("external-2", "loaded"),
    ]);
    const historyInputs: string[] = [];

    const results = await loadSessionHistoryForReadModel({
      repoPath: "/repo",
      adapter: {
        loadSessionHistory: async (input) => {
          historyInputs.push(input.externalSessionId);
          expect(input.systemPromptContext?.systemPrompt).toContain("Task context");
          return [];
        },
      },
      updateSession: (identity, updater) => {
        const current = getAgentSession(sessionCollection, identity);
        if (!current) {
          return;
        }
        sessionCollection = replaceAgentSession(sessionCollection, updater(current));
      },
      sessionCollection,
      liveSessionRefs: [sessionRef("external-1"), sessionRef("external-2")],
      historyRuntimeContext: promptContext,
      isStaleRepoOperation: () => false,
    });

    expect(results).toEqual([{ externalSessionId: "external-1", status: "applied" }]);
    expect(historyInputs).toEqual(["external-1"]);
    expect(getAgentSession(sessionCollection, sessionRef("external-1"))?.historyLoadState).toBe(
      "loaded",
    );
  });

  test("fails explicit history loading for an unknown selected session", async () => {
    await expect(
      loadSessionHistoryForReadModel({
        repoPath: "/repo",
        adapter: { loadSessionHistory: async () => [] },
        updateSession: () => undefined,
        sessionCollection: createAgentSessionCollection([createSession("external-1")]),
        liveSessionRefs: [],
        historyRuntimeContext: promptContext,
        isStaleRepoOperation: () => false,
        requestedSession: {
          externalSessionId: "missing-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
      }),
    ).rejects.toThrow("Cannot load history for unknown session 'missing-session'.");
  });
});
