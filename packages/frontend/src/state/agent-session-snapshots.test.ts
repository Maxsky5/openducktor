import { describe, expect, test } from "bun:test";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
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
  repoPath: overrides.repoPath ?? "/repo",
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
