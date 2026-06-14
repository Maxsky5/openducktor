import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionsStore, toAgentSessionSummary } from "./agent-sessions-store";

describe("toAgentSessionSummary", () => {
  test("preserves session working directory for build-session consumers", () => {
    const session = createAgentSessionFixture({
      role: "build",
      workingDirectory: "/repo",
    });

    expect(toAgentSessionSummary(session)).toMatchObject({
      externalSessionId: session.externalSessionId,
      role: "build",
      workingDirectory: "/repo",
    });
  });
});

describe("createAgentSessionsStore session snapshots", () => {
  test("looks up sessions by canonical runtime identity", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    });

    store.setSessionsById({ [session.externalSessionId]: session });

    expect(
      store.getSessionSnapshot({
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree/",
      }),
    ).toBe(session);
    expect(
      store.getSessionSnapshot({
        externalSessionId: "session-1",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      }),
    ).toBeNull();
  });
});

describe("createAgentSessionsStore activity snapshots", () => {
  test("reuses the activity snapshot when only non-activity fields change", () => {
    const store = createAgentSessionsStore();
    const baseSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      status: "running",
    });

    store.setSessionsById({ [baseSession.externalSessionId]: baseSession });

    const initialSnapshot = store.getActivitySessionsSnapshot();
    const updatedSession = {
      ...baseSession,
      messages: [{ id: "m-1", role: "assistant" as const, content: "Working", timestamp: "now" }],
      draftAssistantText: "draft update",
      todos: [
        {
          id: "todo-1",
          content: "Check logs",
          status: "pending" as const,
          priority: "medium" as const,
        },
      ],
    };

    store.setSessionsById({ [updatedSession.externalSessionId]: updatedSession });

    expect(store.getActivitySessionsSnapshot()).toBe(initialSnapshot);
  });

  test("publishes a new activity snapshot when pending input visibility changes", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      status: "running",
      pendingApprovals: [],
    });

    store.setSessionsById({ [session.externalSessionId]: session });

    const initialSnapshot = store.getActivitySessionsSnapshot();
    const updatedSession = {
      ...session,
      pendingApprovals: [
        {
          requestId: "perm-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["**/*"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
    };

    store.setSessionsById({ [updatedSession.externalSessionId]: updatedSession });

    const nextSnapshot = store.getActivitySessionsSnapshot();
    expect(nextSnapshot).not.toBe(initialSnapshot);
    expect(nextSnapshot[0]).toMatchObject({
      externalSessionId: "session-1",
      hasPendingApprovals: true,
      hasPendingQuestions: false,
    });
  });

  test("omits role-less sessions from activity snapshots", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      status: "running",
      role: null,
    });

    store.setSessionsById({ [session.externalSessionId]: session });

    expect(store.getActivitySessionsSnapshot()).toEqual([]);
  });

  test("resets workspace-scoped activity atomically", () => {
    const store = createAgentSessionsStore("/repo-a");
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      status: "running",
    });

    store.setSessionsById({ [session.externalSessionId]: session });
    expect(store.getActivitySnapshot()).toMatchObject({
      workspaceRepoPath: "/repo-a",
      sessions: [expect.objectContaining({ externalSessionId: "session-1" })],
    });

    store.resetWorkspace("/repo-b");

    expect(store.getSessionsByIdSnapshot()).toEqual({});
    expect(store.getActivitySnapshot()).toEqual({
      workspaceRepoPath: "/repo-b",
      sessions: [],
    });
  });
});
