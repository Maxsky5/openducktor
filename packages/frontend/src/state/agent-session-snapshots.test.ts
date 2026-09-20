import { describe, expect, test } from "bun:test";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentActivitySnapshot,
  createEmptyAgentActivitySnapshot,
} from "./agent-session-snapshots";
import { createSessionMessagesState } from "./operations/agent-orchestrator/support/messages";

const session = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  externalSessionId: "session-1",
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
  runtimeKind: "codex",
  status: "running",
  runtimeStatusMessage: null,
  startedAt: "2026-08-15T10:00:00.000Z",
  workingDirectory: "/repo/worktree",
  livePresence: "unobserved",
  historyLoadState: "loaded",
  messages: createSessionMessagesState("session-1"),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
  ...overrides,
});

describe("createAgentActivitySnapshot", () => {
  test("publishes a task-bound session from its task and role", () => {
    const snapshot = createAgentActivitySnapshot({
      collection: createAgentSessionCollection([session()]),
      previous: createEmptyAgentActivitySnapshot("/repo"),
      workspaceRepoPath: "/repo",
    });

    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      externalSessionId: "session-1",
      taskId: "task-1",
      role: "build",
      activityState: "running",
    });
  });

  test("marks a running session with a background question as waiting for input", () => {
    const liveSession = session({
      pendingAsyncQuestions: [
        {
          questionItemId: "question-1",
          sourceMessageId: "message-1",
          questionIndex: 0,
          title: "Which test should I run?",
          options: null,
        },
        {
          questionItemId: "question-2",
          sourceMessageId: "message-1",
          questionIndex: 1,
          title: "Which environment should I use?",
          options: null,
        },
      ],
    });
    const snapshot = createAgentActivitySnapshot({
      collection: createAgentSessionCollection([liveSession]),
      previous: createEmptyAgentActivitySnapshot("/repo"),
      workspaceRepoPath: "/repo",
    });

    expect(getAgentSessionActivityStateFromSession(liveSession)).toBe("running");
    expect(snapshot.sessions[0]).toMatchObject({
      activityState: "waiting_input",
      pendingQuestionCount: 1,
    });
  });

  test("does not publish a role-less live child", () => {
    const snapshot = createAgentActivitySnapshot({
      collection: createAgentSessionCollection([
        session({
          externalSessionId: "child-session",
          sessionAssociation: { kind: "unbound" },
        }),
      ]),
      previous: createEmptyAgentActivitySnapshot("/repo"),
      workspaceRepoPath: "/repo",
    });

    expect(snapshot.sessions).toEqual([]);
  });
});
