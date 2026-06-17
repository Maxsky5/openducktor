import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionCollection } from "./agent-session-collection";
import { createAgentSessionsStore, toAgentSessionSummary } from "./agent-sessions-store";
import {
  createSessionMessagesState,
  getSessionMessageCount,
} from "./operations/agent-orchestrator/support/messages";

const replaceStoreSessions = (
  store: ReturnType<typeof createAgentSessionsStore>,
  sessions: Parameters<typeof createAgentSessionCollection>[0],
): void => {
  store.setSessionCollection(() => createAgentSessionCollection(sessions));
};

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

  test("publishes product activity instead of raw session status", () => {
    const session = createAgentSessionFixture({
      status: "running",
      pendingQuestions: [{ requestId: "question-1", questions: [] }],
    });

    const summary = toAgentSessionSummary(session);

    expect(summary.activityState).toBe("waiting_input");
    expect(summary).not.toHaveProperty("status");
  });
});

describe("createAgentSessionsStore session snapshots", () => {
  test("updates one session atomically and returns the applied state", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/old",
      status: "idle",
    });
    replaceStoreSessions(store, [session]);

    let notifyCount = 0;
    const unsubscribe = store.subscribe(() => {
      notifyCount += 1;
    });

    const movedSession = store.updateSession(session, (current) => ({
      ...current,
      workingDirectory: "/repo/new",
      status: "running",
    }));
    if (!movedSession) {
      throw new Error("Expected session update to apply.");
    }
    const noopResult = store.updateSession(movedSession, (current) => current);
    unsubscribe();

    expect(movedSession?.status).toBe("running");
    expect(store.getSessionSnapshot(session)).toBeNull();
    expect(store.getSessionSnapshot(movedSession)).toBe(movedSession);
    expect(noopResult).toBeNull();
    expect(notifyCount).toBe(1);
  });

  test("looks up sessions by canonical runtime identity", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    });

    replaceStoreSessions(store, [session]);

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

  test("notifies subscribers for consecutive loading and loaded transcript commits", () => {
    const store = createAgentSessionsStore();
    const identity = {
      externalSessionId: "session-1",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/worktree",
    };
    const session = {
      ...createAgentSessionFixture({
        ...identity,
        taskId: "task-1",
        historyLoadState: "not_requested",
      }),
      messages: createSessionMessagesState(identity.externalSessionId),
    };
    replaceStoreSessions(store, [session]);

    const observedStates: string[] = [];
    const unsubscribe = store.subscribe(() => {
      const current = store.getSessionSnapshot(identity);
      observedStates.push(
        `${current?.historyLoadState ?? "missing"}:${
          current ? getSessionMessageCount(current) : "missing"
        }`,
      );
    });

    replaceStoreSessions(store, [{ ...session, historyLoadState: "loading" }]);
    replaceStoreSessions(store, [
      {
        ...session,
        historyLoadState: "loaded",
        messages: createSessionMessagesState(identity.externalSessionId, [
          {
            id: "message-1",
            role: "assistant",
            content: "Loaded transcript",
            timestamp: "2026-06-14T00:00:00.000Z",
          },
        ]),
      },
    ]);
    unsubscribe();

    expect(observedStates).toEqual(["loading:0", "loaded:1"]);
  });

  test("does not notify subscribers for an equivalent rebuilt collection", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      status: "running",
    });
    replaceStoreSessions(store, [session]);

    let notifyCount = 0;
    const unsubscribe = store.subscribe(() => {
      notifyCount += 1;
    });

    replaceStoreSessions(store, [{ ...session }]);
    unsubscribe();

    expect(notifyCount).toBe(0);
    expect(store.getSessionSnapshot(session)).toBe(session);
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

    replaceStoreSessions(store, [baseSession]);

    const initialSnapshot = store.getActivitySnapshot().sessions;
    const updatedSession = {
      ...baseSession,
      messages: createSessionMessagesState(baseSession.externalSessionId, [
        { id: "m-1", role: "assistant" as const, content: "Working", timestamp: "now" },
      ]),
      todos: [
        {
          id: "todo-1",
          content: "Check logs",
          status: "pending" as const,
          priority: "medium" as const,
        },
      ],
    };

    replaceStoreSessions(store, [updatedSession]);

    expect(store.getActivitySnapshot().sessions).toBe(initialSnapshot);
  });

  test("publishes a new activity snapshot when pending input visibility changes", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      status: "running",
      pendingApprovals: [],
    });

    replaceStoreSessions(store, [session]);

    const initialSnapshot = store.getActivitySnapshot().sessions;
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

    replaceStoreSessions(store, [updatedSession]);

    const nextSnapshot = store.getActivitySnapshot().sessions;
    expect(nextSnapshot).not.toBe(initialSnapshot);
    expect(nextSnapshot[0]).toMatchObject({
      externalSessionId: "session-1",
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
      activityState: "waiting_input",
    });
  });

  test("publishes a new activity snapshot when runtime identity changes", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/opencode",
      status: "running",
    });

    replaceStoreSessions(store, [session]);

    const initialSnapshot = store.getActivitySnapshot().sessions;
    const movedSession = {
      ...session,
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/codex",
    };

    replaceStoreSessions(store, [movedSession]);

    const nextSnapshot = store.getActivitySnapshot().sessions;
    expect(nextSnapshot).not.toBe(initialSnapshot);
    expect(nextSnapshot[0]).toMatchObject({
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo/codex",
      activityState: "running",
    });
  });

  test("keeps activity snapshot sessions distinct by runtime identity", () => {
    const store = createAgentSessionsStore();
    const opencodeSession = createAgentSessionFixture({
      externalSessionId: "shared-session",
      taskId: "task-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/opencode",
      status: "running",
    });
    const codexSession = createAgentSessionFixture({
      externalSessionId: "shared-session",
      taskId: "task-2",
      runtimeKind: "codex",
      workingDirectory: "/repo/codex",
      status: "running",
    });

    replaceStoreSessions(store, [opencodeSession, codexSession]);

    expect(store.getActivitySnapshot().sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalSessionId: "shared-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo/opencode",
          taskId: "task-1",
        }),
        expect.objectContaining({
          externalSessionId: "shared-session",
          runtimeKind: "codex",
          workingDirectory: "/repo/codex",
          taskId: "task-2",
        }),
      ]),
    );
  });

  test("omits role-less sessions from activity snapshots", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      status: "running",
      role: null,
    });

    replaceStoreSessions(store, [session]);

    expect(store.getActivitySnapshot().sessions).toEqual([]);
  });

  test("resets workspace-scoped activity atomically", () => {
    const store = createAgentSessionsStore("/repo-a");
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      status: "running",
    });

    replaceStoreSessions(store, [session]);
    expect(store.getActivitySnapshot()).toMatchObject({
      workspaceRepoPath: "/repo-a",
      sessions: [expect.objectContaining({ externalSessionId: "session-1" })],
    });

    store.resetWorkspace("/repo-b");

    expect(store.getSessionSnapshot(session)).toBeNull();
    expect(store.getActivitySnapshot()).toEqual({
      workspaceRepoPath: "/repo-b",
      sessions: [],
    });
  });
});
