import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { getSessionHistoryFreshnessTracker } from "@openducktor/frontend-core/queries/agent-session-history-freshness-tracker";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionCollection } from "@openducktor/frontend-core/sessions/agent-session-collection";
import {
  createAgentSessionsStore,
  toAgentSessionSummary,
} from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  createSessionMessagesState,
  getSessionMessageCount,
} from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import { createLiveSnapshotEnvelope } from "@openducktor/frontend-core/test-support/agent-session-live-fixture";

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
  test("does not inspect an unchanged transcript when another session updates", () => {
    const store = createAgentSessionsStore("/repo");
    let messageReads = 0;
    const dormant = createAgentSessionFixture({ externalSessionId: "dormant" });
    const messages = Array.from({ length: 10_000 }, (_, index) => ({
      get id() {
        messageReads += 1;
        return `message-${index}`;
      },
      role: "assistant" as const,
      content: "Previous response",
      timestamp: "2026-10-15T00:00:00Z",
    }));
    dormant.messages = createSessionMessagesState(dormant.externalSessionId, messages);
    const active = createAgentSessionFixture({ externalSessionId: "active" });
    replaceStoreSessions(store, [dormant, active]);
    const retained = store.getSessionSnapshot(dormant);
    messageReads = 0;

    store.updateSession(active, (current) => ({ ...current, status: "running" }));

    expect(messageReads).toBe(0);
    expect(store.getSessionSnapshot(dormant)).toBe(retained);
    expect(store.getSessionSnapshot(active)?.status).toBe("running");
  });

  test.each(["sibling", "child", "closed", "gap", "attaching"] as const)(
    "checks connection snapshot coverage after %s without dropping the transcript",
    (change) => {
      const queryClient = new QueryClient();
      const freshnessTracker = getSessionHistoryFreshnessTracker(queryClient);
      const observation = freshnessTracker.observeWorkspace("/repo");
      const session = createAgentSessionFixture({
        workingDirectory: "/repo",
        historyLoadState: "loaded",
      });
      const root: AgentSessionLiveSnapshot = {
        ref: {
          repoPath: "/repo",
          runtimeKind: session.runtimeKind,
          workingDirectory: session.workingDirectory,
          externalSessionId: session.externalSessionId,
        },
        activity: "idle",
        title: "Chat",
        startedAt: session.startedAt,
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
      };
      const child: AgentSessionLiveSnapshot = {
        ...root,
        ref: { ...root.ref, externalSessionId: "child" },
        parentExternalSessionId: session.externalSessionId,
      };
      observation.recordEvent(createLiveSnapshotEnvelope({ sessions: [root, child] }));
      const store = createAgentSessionsStore("/repo", freshnessTracker);
      store.replaceSession({ ...session, historyLoadState: "not_requested" });
      store.updateSession(session, (current) => ({ ...current, historyLoadState: "loading" }));
      store.updateSession(session, () => session);
      if (change === "sibling")
        observation.recordEvent({
          type: "session_upsert",
          session: { ...root, ref: { ...root.ref, externalSessionId: "sibling" } },
        });
      if (change === "child")
        observation.recordEvent({
          type: "session_upsert",
          session: { ...child, activity: "running" },
        });
      if (change === "closed") observation.close();
      if (change === "attaching")
        observation.recordEvent({
          type: "session_upsert",
          session: { ...root, activity: "running" },
        });
      store.applyLiveSessionEnvelope(
        createLiveSnapshotEnvelope({
          sessions: [root, child],
          isConnectionSnapshot: true,
          historyReplayGap: change === "gap",
        }),
      );
      expect(store.getSessionSnapshot(session)?.historyLoadState).toBe(
        change === "sibling" ? "loaded" : "stale",
      );
      expect(store.getSessionSnapshot(session)?.messages).toBe(session.messages);
      observation.close();
      queryClient.clear();
    },
  );
  test.each(["removed", "snapshot"] as const)(
    "clears unregistered policy feedback after %s and keeps runtime identities separate",
    (cleanup) => {
      const store = createAgentSessionsStore("/repo");
      const session = createAgentSessionFixture({
        externalSessionId: "session-1",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
      });
      const snapshot: AgentSessionLiveSnapshot = {
        ref: {
          repoPath: "/repo",
          externalSessionId: session.externalSessionId,
          runtimeKind: session.runtimeKind,
          workingDirectory: session.workingDirectory,
        },
        activity: "running",
        title: "Claude",
        startedAt: "2026-10-03T10:00:00Z",
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
        policyNotice: {
          messageId: "policy",
          message: "Unconfirmed",
          timestamp: "2026-10-03T10:00:00Z",
        },
      };
      store.applyLiveSessionEnvelope({ type: "session_upsert", session: snapshot });
      const siblings = [
        { ...session, runtimeKind: "codex" as const },
        { ...session, workingDirectory: "/repo/other" },
      ];
      for (const sibling of siblings) {
        store.replaceSession(sibling);
        expect(getSessionMessageCount(store.getSessionSnapshot(sibling)!)).toBe(0);
      }
      if (cleanup === "removed") {
        store.applyLiveSessionEnvelope({ type: "session_removed", ref: snapshot.ref });
      } else if (cleanup === "snapshot") {
        store.applyLiveSessionEnvelope(createLiveSnapshotEnvelope({ sessions: [] }));
      }
      store.replaceSession(session);
      expect(getSessionMessageCount(store.getSessionSnapshot(session)!)).toBe(0);
    },
  );

  test("shows a launch failure from a fresh snapshot in time order until the snapshot clears it", () => {
    const store = createAgentSessionsStore("/repo");
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
    });
    const launchFailure = {
      messageId: "launch-failure:1",
      message: "The session launch failed: Timed out. Inspect the session.",
      timestamp: "2026-10-10T10:00:00Z",
    };
    const snapshot: AgentSessionLiveSnapshot = {
      ref: {
        repoPath: "/repo",
        externalSessionId: session.externalSessionId,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
      },
      activity: "idle",
      title: "Builder",
      startedAt: "2026-10-10T09:00:00Z",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
      launchFailure,
    };
    // A browser that opens after the launch only receives the snapshot.
    store.applyLiveSessionEnvelope(createLiveSnapshotEnvelope({ sessions: [snapshot] }));
    store.replaceSession({
      ...session,
      messages: createSessionMessagesState(session.externalSessionId, [
        { id: "before", role: "user", content: "Earlier", timestamp: "2026-10-10T09:30:00Z" },
        { id: "after", role: "assistant", content: "Later", timestamp: "2026-10-10T10:30:00Z" },
      ]),
    });
    const messages = store.getSessionSnapshot(session)!.messages.items;
    expect(messages.map((message) => message.id)).toEqual([
      "before",
      launchFailure.messageId,
      "after",
    ]);
    expect(messages[1]).toMatchObject({
      role: "system",
      content: launchFailure.message,
      meta: { kind: "session_notice", tone: "error", reason: "session_error" },
    });

    store.applyLiveSessionEnvelope({
      type: "session_upsert",
      session: { ...snapshot, launchFailure: undefined },
    });
    store.replaceSession(session);
    expect(getSessionMessageCount(store.getSessionSnapshot(session)!)).toBe(0);
  });

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
});

test("lists and removes task owners only in its bound workspace", () => {
  const store = createAgentSessionsStore("/a");
  replaceStoreSessions(store, [
    createAgentSessionFixture({
      externalSessionId: "build",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    }),
    createAgentSessionFixture({
      externalSessionId: "spec",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
    }),
    createAgentSessionFixture({
      externalSessionId: "removed",
      sessionAssociation: { kind: "workflow", taskId: "task-2", role: "build" },
    }),
    createAgentSessionFixture({
      externalSessionId: "repository",
      sessionAssociation: { kind: "repository" },
    }),
  ]);
  expect(store.listSessionTaskIds("/a").sort()).toEqual(["task-1", "task-2"]);

  store.removeTaskSessions("/b", ["task-1"]);
  expect(store.listSessionTaskIds("/a").sort()).toEqual(["task-1", "task-2"]);
  store.removeTaskSessions("/a", ["task-2"]);

  expect(store.listSessionTaskIds("/a")).toEqual(["task-1"]);
  expect(store.listSessionTaskIds("/b")).toEqual([]);
});

test.each(["idle", "running"] as const)(
  "a late conclusive refusal settles only its optimistic input and keeps native %s activity",
  (activity) => {
    const store = createAgentSessionsStore("/repo");
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      workingDirectory: "/repo/tree",
      runtimeKind: "codex",
      status: "running",
      pendingSubmissionId: "submission-1",
      pendingUserMessageStartedAt: 100,
    });
    replaceStoreSessions(store, [session]);
    const ref = {
      repoPath: "/repo",
      workingDirectory: session.workingDirectory,
      runtimeKind: session.runtimeKind,
      externalSessionId: session.externalSessionId,
    };
    const snapshot: AgentSessionLiveSnapshot = {
      ref,
      activity,
      title: "Chat",
      startedAt: session.startedAt,
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
    store.applyLiveSessionEnvelope(
      createLiveSnapshotEnvelope({
        sessions: [snapshot],
        sessionOperations: [
          {
            ref,
            kind: "submission",
            pending: false,
            nativeOutcome: "not_issued",
            submissionId: "submission-1",
            failure: {
              stage: "model",
              code: "invalid_model",
              message: "Select a model.",
              nextAction: "Refresh the catalog.",
            },
          },
        ],
      }),
    );
    store.replaceSession(session);
    expect(store.getSessionSnapshot(session)).toMatchObject({ status: activity });
    expect(store.getSessionSnapshot(session)?.pendingSubmissionId).toBeUndefined();
    expect(store.getSessionSnapshot(session)?.pendingUserMessageStartedAt).toBeUndefined();
  },
);
