import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
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
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
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
  test("publishes repository activity and pending input without leaking it into workflow summaries", () => {
    const store = createAgentSessionsStore("/repo");
    const session = createAgentSessionFixture({
      externalSessionId: "chat-1",
      sessionAssociation: { kind: "repository" },
      status: "running",
    });
    replaceStoreSessions(store, [session]);
    expect(store.getActivitySnapshot().sessions).toEqual([]);
    expect(store.getActivitySnapshot().repositorySessions).toMatchObject([
      { externalSessionId: "chat-1", activityState: "running" },
    ]);
    const snapshot = store.getActivitySnapshot();
    store.updateSession(session, (current) => ({
      ...current,
      messages: createSessionMessagesState(current.externalSessionId, [
        { id: "m1", role: "assistant", content: "Working", timestamp: "now" },
      ]),
    }));
    expect(store.getActivitySnapshot()).toBe(snapshot);
    store.replaceSession(
      createAgentSessionFixture({
        externalSessionId: "child",
        sessionAssociation: { kind: "repository" },
        liveParentExternalSessionId: "chat-1",
        status: "running",
      }),
    );
    expect(store.getActivitySnapshot()).toBe(snapshot);
    store.updateSession(session, (current) => ({
      ...current,
      pendingQuestions: [{ requestId: "q1", questions: [] }],
    }));
    expect(store.getActivitySnapshot().repositorySessions).toMatchObject([
      { externalSessionId: "chat-1", activityState: "waiting_input", pendingQuestionCount: 1 },
    ]);
    store.updateSession(session, (current) => ({
      ...current,
      pendingQuestions: [],
      pendingApprovals: [
        {
          requestId: "p1",
          requestType: "permission_grant",
          title: "Approve",
          summary: "Approve a command",
          action: { name: "bash" },
          mutation: "unknown",
          supportedReplyOutcomes: ["approve_once", "reject"],
        },
      ],
    }));
    expect(store.getActivitySnapshot().repositorySessions).toMatchObject([
      { activityState: "waiting_input", pendingApprovalCount: 1, pendingQuestionCount: 0 },
    ]);
    store.resetWorkspace("/other");
    expect(store.getActivitySnapshot().repositorySessions).toEqual([]);
  });
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
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
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

  test("lists the current session snapshots without exposing the collection", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
    });
    replaceStoreSessions(store, [session]);

    const snapshots = store.listSessionSnapshots();
    snapshots.length = 0;

    expect(store.listSessionSnapshots()).toEqual([session]);
  });

  test("replaces and removes sessions through store-owned mutations", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      status: "starting",
    });

    let notifyCount = 0;
    const unsubscribe = store.subscribe(() => {
      notifyCount += 1;
    });

    store.replaceSession(session);
    expect(store.getSessionSnapshot(session)).toBe(session);

    store.removeSession(session);
    unsubscribe();

    expect(store.getSessionSnapshot(session)).toBeNull();
    expect(notifyCount).toBe(2);
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
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
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

  test("publishes association changes through the session store", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "repository-session",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      sessionAssociation: { kind: "unbound" },
    });
    replaceStoreSessions(store, [session]);
    let notificationCount = 0;
    const unsubscribeSession = store.subscribe(() => {
      notificationCount += 1;
    });

    store.updateSession(session, (current) => ({
      ...current,
      sessionAssociation: { kind: "repository" },
    }));
    unsubscribeSession();

    expect(store.getSessionSnapshot(session)?.sessionAssociation).toEqual({ kind: "repository" });
    expect(notificationCount).toBe(1);
  });

  test("commits a collection update and returns the result from the same current collection", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      status: "idle",
    });
    replaceStoreSessions(store, [session]);

    let notifyCount = 0;
    const unsubscribe = store.subscribe(() => {
      notifyCount += 1;
    });

    const nextSession = { ...session, status: "running" as const };
    const result = store.commitSessionCollection((current) => ({
      collection: createAgentSessionCollection([nextSession]),
      result: current.get(agentSessionIdentityKey(session))?.status ?? null,
    }));
    unsubscribe();

    expect(result).toBe("idle");
    expect(store.getSessionSnapshot(session)).toBe(nextSession);
    expect(notifyCount).toBe(1);
  });
});

describe("createAgentSessionsStore repository retention", () => {
  const createLoadedSession = (
    externalSessionId: string,
    workingDirectory: string,
    content: string,
  ) =>
    createAgentSessionFixture({
      externalSessionId,
      runtimeKind: "opencode",
      workingDirectory,
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
      status: "idle",
      historyLoadState: "loaded",
      messages: createSessionMessagesState(externalSessionId, [
        {
          id: `${externalSessionId}-message`,
          role: "assistant",
          content,
          timestamp: "2026-09-18T00:00:00.000Z",
        },
      ]),
    });

  test("restores a retained repository transcript on return", () => {
    const store = createAgentSessionsStore("/repo-a");
    const session = createLoadedSession("session-a", "/repo-a/worktree", "Transcript A");
    replaceStoreSessions(store, [session]);

    store.resetWorkspace("/repo-b");

    expect(store.getSessionSnapshot(session)).toBeNull();
    expect(store.listSessionSnapshots()).toEqual([]);

    store.resetWorkspace("/repo-a");

    const restored = store.getSessionSnapshot(session);
    expect(restored).toBe(session);
    expect(restored?.historyLoadState).toBe("loaded");
    expect(store.listSessionSnapshots()).toEqual([session]);
  });

  test("scopes the activity snapshot and session reads to the active repository", () => {
    const store = createAgentSessionsStore("/repo-a");
    const sessionA = createLoadedSession("session-a", "/repo-a/worktree", "Transcript A");
    const sessionB = createLoadedSession("session-b", "/repo-b/worktree", "Transcript B");
    replaceStoreSessions(store, [sessionA]);

    store.resetWorkspace("/repo-b");

    expect(store.getActivitySnapshot()).toEqual({
      workspaceRepoPath: "/repo-b",
      sessions: [],
      repositorySessions: [],
    });

    replaceStoreSessions(store, [sessionB]);

    expect(store.getActivitySnapshot()).toMatchObject({
      workspaceRepoPath: "/repo-b",
      sessions: [expect.objectContaining({ externalSessionId: "session-b" })],
    });

    store.resetWorkspace("/repo-a");

    const snapshot = store.getActivitySnapshot();
    expect(snapshot.workspaceRepoPath).toBe("/repo-a");
    expect(snapshot.sessions).toEqual([
      expect.objectContaining({ externalSessionId: "session-a" }),
    ]);
    expect(store.getSessionSnapshot(sessionB)).toBeNull();
    expect(store.listSessionSnapshots()).toEqual([sessionA]);
  });

  test("retains every visited repository collection", () => {
    const store = createAgentSessionsStore("/repo-a");
    const sessionA = createLoadedSession("session-a", "/repo-a/worktree", "Transcript A");
    const sessionB = createLoadedSession("session-b", "/repo-b/worktree", "Transcript B");
    const sessionC = createLoadedSession("session-c", "/repo-c/worktree", "Transcript C");
    replaceStoreSessions(store, [sessionA]);
    store.resetWorkspace("/repo-b");
    replaceStoreSessions(store, [sessionB]);
    store.resetWorkspace("/repo-c");
    replaceStoreSessions(store, [sessionC]);

    store.resetWorkspace("/repo-b");
    expect(store.getSessionSnapshot(sessionB)).toBe(sessionB);

    store.resetWorkspace("/repo-a");
    expect(store.getSessionSnapshot(sessionA)).toBe(sessionA);

    store.resetWorkspace("/repo-c");
    expect(store.getSessionSnapshot(sessionC)).toBe(sessionC);
  });

  test("reopens an interrupted history load when its repository becomes inactive", () => {
    const store = createAgentSessionsStore("/repo-a");
    const session = {
      ...createLoadedSession("session-a", "/repo-a/worktree", "Partial transcript"),
      historyLoadState: "loading" as const,
    };
    replaceStoreSessions(store, [session]);

    store.resetWorkspace("/repo-b");
    store.resetWorkspace("/repo-a");

    const restored = store.getSessionSnapshot(session);
    expect(restored?.historyLoadState).toBe("not_requested");
    expect(restored?.messages).toEqual(session.messages);
  });

  test("rejects a late update for a session outside the active repository", () => {
    const store = createAgentSessionsStore("/repo-a");
    const sessionA = createLoadedSession("session-a", "/repo-a/worktree", "Transcript A");
    replaceStoreSessions(store, [sessionA]);

    store.resetWorkspace("/repo-b");

    expect(
      store.updateSession(sessionA, (current) => ({ ...current, status: "running" })),
    ).toBeNull();
    expect(store.getSessionSnapshot(sessionA)).toBeNull();

    store.resetWorkspace("/repo-a");

    expect(store.getSessionSnapshot(sessionA)?.status).toBe("idle");
  });
});

describe("createAgentSessionsStore activity snapshots", () => {
  test("reuses the activity snapshot when only non-activity fields change", () => {
    const store = createAgentSessionsStore();
    const baseSession = createAgentSessionFixture({
      externalSessionId: "session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
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
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
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
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
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
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
      runtimeKind: "opencode",
      workingDirectory: "/repo/opencode",
      status: "running",
    });
    const codexSession = createAgentSessionFixture({
      externalSessionId: "shared-session",
      sessionAssociation: { kind: "workflow", taskId: "task-2", role: "spec" },
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
      sessionAssociation: { kind: "unbound" },
      status: "running",
    });

    replaceStoreSessions(store, [session]);

    expect(store.getActivitySnapshot().sessions).toEqual([]);
  });

  test("resets workspace-scoped activity atomically", () => {
    const store = createAgentSessionsStore("/repo-a");
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
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
      repositorySessions: [],
    });
  });
});
