import { describe, expect, test } from "bun:test";
import { createAgentSessionCollection } from "./agent-session-collection";
import { getAgentSessionActivityStateFromSession } from "../lib/agent-session-activity-state";
import type { AgentSessionState } from "../types/agent-orchestrator";
import {
  createAgentActivitySnapshot,
  createEmptyAgentActivitySnapshot,
} from "./agent-session-snapshots";
import { createSessionMessagesState } from "./agent-orchestrator/support/messages";
import { createAgentSessionsStore } from "./agent-sessions-store";

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
  test.each(["workflow", "repository"] as const)(
    "publishes cause-only status failure and recovery to %s summary subscribers",
    (kind) => {
      const store = createAgentSessionsStore("/repo");
      const liveSession = session({
        runtimeKind: "claude",
        sessionAssociation:
          kind === "workflow" ? { kind, taskId: "task-1", role: "build" } : { kind },
      });
      store.replaceSession(liveSession);
      const summaries = () => {
        const snapshot = store.getActivitySnapshot();
        return kind === "workflow" ? snapshot.sessions : snapshot.repositorySessions;
      };
      const published: ReturnType<typeof summaries>[] = [];
      const unsubscribe = store.subscribe(() => published.push(summaries()));
      const reasons = [
        "Claude status is unavailable. Reconnect the runtime.",
        "Claude status is unavailable. Update Claude Code.",
        null,
      ];
      let previous = summaries();
      try {
        for (const statusUnavailableReason of reasons) {
          store.updateSession(liveSession, (current) => ({ ...current, statusUnavailableReason }));
          expect(summaries()).not.toBe(previous);
          expect(summaries()[0]).toMatchObject({
            activityState: "running",
            statusUnavailableReason,
          });
          previous = summaries();
        }
        expect(published).toHaveLength(3);
      } finally {
        unsubscribe();
      }
    },
  );

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
      pendingQuestions: [
        {
          requestId: "message-1",
          blocking: false,
          questions: [
            { header: "Test", question: "Which test should I run?", options: [] },
            {
              header: "Environment",
              question: "Which environment should I use?",
              options: [],
            },
          ],
        },
      ],
    });
    const snapshot = createAgentActivitySnapshot({
      collection: createAgentSessionCollection([liveSession]),
      previous: createEmptyAgentActivitySnapshot("/repo"),
      workspaceRepoPath: "/repo",
    });

    expect(getAgentSessionActivityStateFromSession(liveSession)).toBe("waiting_input");
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
