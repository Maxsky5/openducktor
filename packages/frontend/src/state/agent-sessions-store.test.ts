import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionCollection, listAgentSessions } from "./agent-session-collection";
import { createAgentSessionsStore, toAgentSessionSummary } from "./agent-sessions-store";
import {
  createSessionMessagesState,
  getSessionMessageCount,
} from "./operations/agent-orchestrator/support/messages";

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
  test("updates one session atomically and returns the applied state", () => {
    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/old",
      status: "idle",
    });
    store.setSessionCollection(createAgentSessionCollection([session]));

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

    store.setSessionCollection(createAgentSessionCollection([session]));

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
    store.setSessionCollection(createAgentSessionCollection([session]));

    const observedStates: string[] = [];
    const unsubscribe = store.subscribe(() => {
      const current = store.getSessionSnapshot(identity);
      observedStates.push(
        `${current?.historyLoadState ?? "missing"}:${
          current ? getSessionMessageCount(current) : "missing"
        }`,
      );
    });

    store.setSessionCollection(
      createAgentSessionCollection([{ ...session, historyLoadState: "loading" }]),
    );
    store.setSessionCollection(
      createAgentSessionCollection([
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
      ]),
    );
    unsubscribe();

    expect(observedStates).toEqual(["loading:0", "loaded:1"]);
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

    store.setSessionCollection(createAgentSessionCollection([baseSession]));

    const initialSnapshot = store.getActivitySessionsSnapshot();
    const updatedSession = {
      ...baseSession,
      messages: createSessionMessagesState(baseSession.externalSessionId, [
        { id: "m-1", role: "assistant" as const, content: "Working", timestamp: "now" },
      ]),
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

    store.setSessionCollection(createAgentSessionCollection([updatedSession]));

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

    store.setSessionCollection(createAgentSessionCollection([session]));

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

    store.setSessionCollection(createAgentSessionCollection([updatedSession]));

    const nextSnapshot = store.getActivitySessionsSnapshot();
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

    store.setSessionCollection(createAgentSessionCollection([session]));

    const initialSnapshot = store.getActivitySessionsSnapshot();
    const movedSession = {
      ...session,
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/codex",
    };

    store.setSessionCollection(createAgentSessionCollection([movedSession]));

    const nextSnapshot = store.getActivitySessionsSnapshot();
    expect(nextSnapshot).not.toBe(initialSnapshot);
    expect(nextSnapshot[0]).toMatchObject({
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo/codex",
      activityState: "running",
    });
  });

  test("keeps activity summaries distinct by runtime identity", () => {
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

    store.setSessionCollection(createAgentSessionCollection([opencodeSession, codexSession]));

    expect(store.getActivitySessionsSnapshot()).toEqual(
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

    store.setSessionCollection(createAgentSessionCollection([session]));

    expect(store.getActivitySessionsSnapshot()).toEqual([]);
  });

  test("resets workspace-scoped activity atomically", () => {
    const store = createAgentSessionsStore("/repo-a");
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      taskId: "task-1",
      status: "running",
    });

    store.setSessionCollection(createAgentSessionCollection([session]));
    expect(store.getActivitySnapshot()).toMatchObject({
      workspaceRepoPath: "/repo-a",
      sessions: [expect.objectContaining({ externalSessionId: "session-1" })],
    });

    store.resetWorkspace("/repo-b");

    expect(listAgentSessions(store.getSessionCollectionSnapshot())).toEqual([]);
    expect(store.getActivitySnapshot()).toEqual({
      workspaceRepoPath: "/repo-b",
      sessions: [],
    });
  });
});
