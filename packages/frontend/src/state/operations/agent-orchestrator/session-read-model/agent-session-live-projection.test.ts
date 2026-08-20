import { describe, expect, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  AgentSessionRecord,
} from "@openducktor/contracts";
import {
  emptyAgentSessionCollection,
  getAgentSession,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionRuntimeTarget } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import {
  applyAgentSessionLiveDelta,
  applyTaskSessionRecords,
  buildAgentSessionLiveCollection,
} from "./agent-session-live-projection";
import { collectPendingApprovalPolicyActions } from "./pending-approval-policy";
import type { TaskSessionRecords } from "./task-session-records";

const repoPath = "/repo";
const workingDirectory = "/repo/worktree";

const record = (
  externalSessionId: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  runtimeKind: "codex",
  workingDirectory,
  startedAt: "2026-07-16T08:00:00.000Z",
  selectedModel: null,
  ...overrides,
});

const taskSessionRecords = (
  ...records: Array<{ taskId: string; record: AgentSessionRecord }>
): TaskSessionRecords => ({
  taskIds: [...new Set(records.map(({ taskId }) => taskId))],
  records,
});

const snapshot = (
  externalSessionId: string,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath,
    runtimeKind: "codex",
    workingDirectory,
    externalSessionId,
  },
  sessionAssociation: { kind: "unbound" },
  activity: "idle",
  title: `Session ${externalSessionId}`,
  startedAt: "2026-07-16T08:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

const identity = (externalSessionId: string): AgentSessionIdentity => ({
  runtimeKind: "codex",
  workingDirectory,
  externalSessionId,
});

const target = (externalSessionId: string): AgentSessionRuntimeTarget => ({
  ...identity(externalSessionId),
  sessionAssociation: { kind: "unbound" },
});

describe("agent session live projection", () => {
  test("hydrates persisted task records with a workflow association", () => {
    const sessions = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords({
        taskId: "task-1",
        record: record("thread-1", { role: "qa" }),
      }),
      snapshots: [],
    });

    expect(getAgentSession(sessions, identity("thread-1"))?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "qa",
    });
  });

  test("rejects a persisted repository-to-workflow scope change", () => {
    const current = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords(),
      snapshots: [
        snapshot("thread-1", {
          sessionAssociation: { kind: "repository" },
        }),
      ],
    });

    expect(() =>
      applyTaskSessionRecords({
        current,
        taskSessionRecords: taskSessionRecords({
          taskId: "task-1",
          record: record("thread-1"),
        }),
      }),
    ).toThrow(
      "Cannot reconcile persisted session 'thread-1' because its registered repository scope does not match the incoming workflow scope for task 'task-1' and role 'build'.",
    );
  });

  test("keeps a matching workflow scope from persisted records", () => {
    const current = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords(),
      snapshots: [
        snapshot("thread-1", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ],
    });

    const next = applyTaskSessionRecords({
      current,
      taskSessionRecords: taskSessionRecords({
        taskId: "task-1",
        record: record("thread-1"),
      }),
    });

    expect(getAgentSession(next, identity("thread-1"))?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });
  });

  test("rejects a conflicting workflow scope from persisted records", () => {
    const current = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords(),
      snapshots: [
        snapshot("thread-1", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        }),
      ],
    });

    expect(() =>
      applyTaskSessionRecords({
        current,
        taskSessionRecords: taskSessionRecords({
          taskId: "task-2",
          record: record("thread-1"),
        }),
      }),
    ).toThrow(
      "Cannot reconcile persisted session 'thread-1' because its registered workflow scope for task 'task-1' and role 'spec' does not match the incoming workflow scope for task 'task-2' and role 'build'.",
    );
  });

  test("hydrates an unbound session from persisted workflow scope and refreshes parent routing", () => {
    const current = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords(),
      snapshots: [
        snapshot("parent-thread"),
        snapshot("child-thread", {
          parentExternalSessionId: "parent-thread",
          pendingApprovals: [
            {
              requestId: "child-approval",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
          pendingQuestions: [
            {
              requestId: "child-question",
              questions: [
                {
                  header: "Continue?",
                  question: "Should the child continue?",
                  options: [{ label: "Yes", description: "Continue." }],
                },
              ],
            },
          ],
        }),
      ],
    });

    const next = applyTaskSessionRecords({
      current,
      taskSessionRecords: taskSessionRecords({
        taskId: "task-1",
        record: record("child-thread"),
      }),
    });
    const workflowAssociation = { kind: "workflow", taskId: "task-1", role: "build" } as const;

    expect(getAgentSession(next, identity("child-thread"))?.sessionAssociation).toEqual(
      workflowAssociation,
    );
    expect(getAgentSession(next, identity("parent-thread"))?.pendingApprovals).toEqual([
      expect.objectContaining({
        requestId: "child-approval",
        responseSession: { ...identity("child-thread"), sessionAssociation: workflowAssociation },
      }),
    ]);
    expect(getAgentSession(next, identity("parent-thread"))?.pendingQuestions).toEqual([
      expect.objectContaining({
        requestId: "child-question",
        responseSession: { ...identity("child-thread"), sessionAssociation: workflowAssociation },
      }),
    ]);
  });

  test.each(["opencode", "codex", "claude"] as const)(
    "projects a repository association for a live %s session",
    (runtimeKind) => {
      const runtimeIdentity = { ...identity(`${runtimeKind}-thread`), runtimeKind };
      const sessions = buildAgentSessionLiveCollection({
        current: emptyAgentSessionCollection(),
        taskSessionRecords: taskSessionRecords(),
        snapshots: [
          snapshot(runtimeIdentity.externalSessionId, {
            ref: { repoPath, ...runtimeIdentity },
            sessionAssociation: { kind: "repository" },
          }),
        ],
      });

      expect(getAgentSession(sessions, runtimeIdentity)?.sessionAssociation).toEqual({
        kind: "repository",
      });
    },
  );

  test("keeps a runtime-discovered session unbound", () => {
    const sessions = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords(),
      snapshots: [snapshot("unbound-thread")],
    });

    expect(getAgentSession(sessions, identity("unbound-thread"))?.sessionAssociation).toEqual({
      kind: "unbound",
    });
  });

  test("allows an unbound-to-repository scope change", () => {
    const initial = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords(),
      snapshots: [snapshot("thread-1")],
    });
    const next = applyAgentSessionLiveDelta({
      current: initial,
      taskSessionRecords: taskSessionRecords(),
      envelope: {
        type: "session_upsert",
        session: snapshot("thread-1", { sessionAssociation: { kind: "repository" } }),
      },
    });

    expect(getAgentSession(next, identity("thread-1"))?.sessionAssociation).toEqual({
      kind: "repository",
    });
  });

  test("retains a workflow association when a live snapshot is unbound", () => {
    const sessions = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords({
        taskId: "task-1",
        record: record("thread-1", { role: "build" }),
      }),
      snapshots: [snapshot("thread-1")],
    });

    expect(getAgentSession(sessions, identity("thread-1"))?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });
  });

  test("rejects a conflicting live scope change", () => {
    const tasks = taskSessionRecords({
      taskId: "task-1",
      record: record("thread-1", { role: "build" }),
    });
    const initial = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [],
    });

    expect(() =>
      applyAgentSessionLiveDelta({
        current: initial,
        taskSessionRecords: tasks,
        envelope: {
          type: "session_upsert",
          session: snapshot("thread-1", { sessionAssociation: { kind: "repository" } }),
        },
      }),
    ).toThrow(
      "Cannot apply live snapshot for session 'thread-1' because its registered workflow scope for task 'task-1' and role 'build' does not match the incoming repository scope.",
    );
  });

  test("commits an atomic initial snapshot with activity, pending input, and retained context", () => {
    const tasks = taskSessionRecords(
      { taskId: "task-1", record: record("thread-1") },
      { taskId: "task-2", record: record("thread-2") },
      { taskId: "task-3", record: record("thread-3") },
    );
    const sessions = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("thread-1", {
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "opaque-1",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
          contextUsage: { totalTokens: 1200, contextWindow: 200_000 },
        }),
        snapshot("thread-2", {
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "opaque-2",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
        }),
        snapshot("thread-3", {
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "opaque-3",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("thread-1"))).toEqual(
      expect.objectContaining({
        status: "idle",
        contextUsage: { totalTokens: 1200, contextWindow: 200_000 },
        pendingApprovals: [expect.objectContaining({ requestId: "opaque-1" })],
      }),
    );
    expect(getAgentSession(sessions, identity("thread-2"))?.pendingApprovals).toHaveLength(1);
    expect(getAgentSession(sessions, identity("thread-3"))?.pendingApprovals).toHaveLength(1);
  });

  test("applies ordered upserts without duplicating or resurrecting pending requests", () => {
    const tasks = taskSessionRecords({ taskId: "task-1", record: record("thread-1") });
    const initial = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("thread-1", {
          pendingApprovals: [
            {
              requestId: "opaque-1",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
        }),
      ],
    });
    const resolved = {
      type: "session_upsert",
      session: snapshot("thread-1", { pendingApprovals: [] }),
    } satisfies AgentSessionLiveEnvelope;

    const afterResolution = applyAgentSessionLiveDelta({
      current: initial,
      taskSessionRecords: tasks,
      envelope: resolved,
    });
    const afterDuplicateResolution = applyAgentSessionLiveDelta({
      current: afterResolution,
      taskSessionRecords: tasks,
      envelope: resolved,
    });

    expect(getAgentSession(afterResolution, identity("thread-1"))?.pendingApprovals).toEqual([]);
    expect(
      getAgentSession(afterDuplicateResolution, identity("thread-1"))?.pendingApprovals,
    ).toEqual([]);
  });

  test("treats a reconnect snapshot as authoritative when a child request disappeared", () => {
    const tasks = taskSessionRecords({ taskId: "task-1", record: record("parent-thread") });
    const previous = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("parent-thread"),
        snapshot("child-thread", {
          parentExternalSessionId: "parent-thread",
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "child-opaque-1",
              requestType: "command_execution",
              title: "Run child command",
            },
          ],
        }),
      ],
    });
    expect(getAgentSession(previous, identity("parent-thread"))?.pendingApprovals).toHaveLength(1);
    expect(getAgentSession(previous, identity("child-thread"))).not.toBeNull();

    const reconnected = buildAgentSessionLiveCollection({
      current: previous,
      taskSessionRecords: tasks,
      snapshots: [snapshot("parent-thread")],
    });

    expect(getAgentSession(reconnected, identity("parent-thread"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(reconnected, identity("child-thread"))).toBeNull();
  });

  test("preserves a live child's loaded transcript across an authoritative snapshot refresh", () => {
    const tasks = taskSessionRecords({ taskId: "task-1", record: record("parent-thread") });
    const initial = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("parent-thread"),
        snapshot("child-thread", { parentExternalSessionId: "parent-thread" }),
      ],
    });
    const child = getAgentSession(initial, identity("child-thread"));
    if (!child) {
      throw new Error("Expected live child session.");
    }
    const withLoadedChild = replaceAgentSession(initial, {
      ...child,
      historyLoadState: "loaded",
      messages: createSessionMessagesState("child-thread", [
        {
          id: "assistant-child-1",
          role: "assistant",
          content: "Still visible after reconnect",
          timestamp: "2026-07-16T08:00:01.000Z",
        },
      ]),
    });

    const refreshed = buildAgentSessionLiveCollection({
      current: withLoadedChild,
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("parent-thread"),
        snapshot("child-thread", { parentExternalSessionId: "parent-thread" }),
      ],
    });

    expect(getAgentSession(refreshed, identity("child-thread"))).toMatchObject({
      historyLoadState: "loaded",
      messages: {
        items: [expect.objectContaining({ content: "Still visible after reconnect" })],
      },
    });
  });

  test("settles a removed live child without dropping its transcript", () => {
    const tasks = taskSessionRecords({ taskId: "task-1", record: record("parent-thread") });
    const initial = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("parent-thread"),
        snapshot("child-thread", {
          parentExternalSessionId: "parent-thread",
          activity: "running",
        }),
      ],
    });
    const child = getAgentSession(initial, identity("child-thread"));
    if (!child) {
      throw new Error("Expected live child session.");
    }
    const withChildTranscript = replaceAgentSession(initial, {
      ...child,
      historyLoadState: "loaded",
      messages: createSessionMessagesState("child-thread", [
        {
          id: "tool:assistant-child-1:read-1",
          role: "tool",
          content: "Tool Read completed",
          timestamp: "2026-07-16T08:00:01.000Z",
          meta: {
            kind: "tool",
            partId: "read-1",
            callId: "read-1",
            tool: "Read",
            toolType: "read",
            status: "completed",
            startedAtMs: 100,
            endedAtMs: 160,
          },
        },
      ]),
    });

    const removed = applyAgentSessionLiveDelta({
      current: withChildTranscript,
      taskSessionRecords: tasks,
      envelope: { type: "session_removed", ref: snapshot("child-thread").ref },
    });

    expect(getAgentSession(removed, identity("child-thread"))).toMatchObject({
      status: "idle",
      liveParentExternalSessionId: undefined,
      historyLoadState: "loaded",
      messages: {
        items: [
          expect.objectContaining({
            id: "tool:assistant-child-1:read-1",
            meta: expect.objectContaining({ startedAtMs: 100, endedAtMs: 160 }),
          }),
        ],
      },
    });
  });

  test("mirrors a grandchild mutating approval to a read-only root with the grandchild response session", () => {
    const tasks = taskSessionRecords({
      taskId: "task-1",
      record: record("root-thread", { role: "spec" }),
    });
    const sessions = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("root-thread"),
        snapshot("child-thread", { parentExternalSessionId: "root-thread" }),
        snapshot("grandchild-thread", {
          parentExternalSessionId: "child-thread",
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "grandchild-approval",
              requestType: "command_execution",
              title: "Write file",
              mutation: "mutating",
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("root-thread"))?.pendingApprovals).toEqual([
      expect.objectContaining({
        requestId: "grandchild-approval",
        source: {
          kind: "subagent",
          parentExternalSessionId: "root-thread",
          childExternalSessionId: "grandchild-thread",
        },
        responseSession: target("grandchild-thread"),
      }),
    ]);
    expect(
      collectPendingApprovalPolicyActions({
        previous: emptyAgentSessionCollection(),
        next: sessions,
        repoPath,
      }),
    ).toEqual([
      {
        role: "spec",
        input: {
          repoPath,
          runtimeKind: "codex",
          workingDirectory,
          externalSessionId: "grandchild-thread",
          requestId: "grandchild-approval",
          outcome: "reject",
        },
      },
    ]);
  });

  test("mirrors a grandchild question to the root with the grandchild response session", () => {
    const sessions = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords({ taskId: "task-1", record: record("root-thread") }),
      snapshots: [
        snapshot("root-thread"),
        snapshot("child-thread", { parentExternalSessionId: "root-thread" }),
        snapshot("grandchild-thread", {
          parentExternalSessionId: "child-thread",
          activity: "waiting_for_question",
          pendingQuestions: [
            {
              requestId: "grandchild-question",
              questions: [
                {
                  header: "Continue?",
                  question: "Should the grandchild continue?",
                  options: [{ label: "Yes", description: "Continue." }],
                },
              ],
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("root-thread"))?.pendingQuestions).toEqual([
      expect.objectContaining({
        requestId: "grandchild-question",
        responseSession: target("grandchild-thread"),
      }),
    ]);
  });

  test("clears descendant mirrors from every ancestor after grandchild resolution and removal", () => {
    const tasks = taskSessionRecords({ taskId: "task-1", record: record("root-thread") });
    const initial = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("root-thread"),
        snapshot("child-thread", { parentExternalSessionId: "root-thread" }),
        snapshot("grandchild-thread", {
          parentExternalSessionId: "child-thread",
          pendingApprovals: [
            {
              requestId: "grandchild-approval",
              requestType: "command_execution",
              title: "Write file",
            },
          ],
          pendingQuestions: [
            {
              requestId: "grandchild-question",
              questions: [
                {
                  header: "Continue?",
                  question: "Should the grandchild continue?",
                  options: [{ label: "Yes", description: "Continue." }],
                },
              ],
            },
          ],
        }),
      ],
    });
    const resolved = applyAgentSessionLiveDelta({
      current: initial,
      taskSessionRecords: tasks,
      envelope: {
        type: "session_upsert",
        session: snapshot("grandchild-thread", {
          parentExternalSessionId: "child-thread",
        }),
      },
    });

    expect(getAgentSession(resolved, identity("root-thread"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(resolved, identity("child-thread"))?.pendingQuestions).toEqual([]);

    const removed = applyAgentSessionLiveDelta({
      current: initial,
      taskSessionRecords: tasks,
      envelope: { type: "session_removed", ref: snapshot("grandchild-thread").ref },
    });
    expect(getAgentSession(removed, identity("root-thread"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(removed, identity("child-thread"))?.pendingQuestions).toEqual([]);
  });

  test("keeps sibling descendant pending requests isolated", () => {
    const sessions = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords({ taskId: "task-1", record: record("root-thread") }),
      snapshots: [
        snapshot("root-thread"),
        snapshot("child-a", { parentExternalSessionId: "root-thread" }),
        snapshot("child-b", { parentExternalSessionId: "root-thread" }),
        snapshot("grandchild-a", {
          parentExternalSessionId: "child-a",
          pendingApprovals: [
            {
              requestId: "sibling-request",
              requestType: "command_execution",
              title: "Child A command",
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("child-a"))?.pendingApprovals).toHaveLength(1);
    expect(getAgentSession(sessions, identity("child-b"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(sessions, identity("root-thread"))?.pendingApprovals).toEqual([
      expect.objectContaining({ responseSession: target("grandchild-a") }),
    ]);
  });

  test("retains one-hop pending input projection", () => {
    const sessions = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: taskSessionRecords({ taskId: "task-1", record: record("root-thread") }),
      snapshots: [
        snapshot("root-thread"),
        snapshot("child-thread", {
          parentExternalSessionId: "root-thread",
          pendingApprovals: [
            {
              requestId: "child-approval",
              requestType: "command_execution",
              title: "Child command",
            },
          ],
        }),
      ],
    });

    expect(getAgentSession(sessions, identity("root-thread"))?.pendingApprovals).toEqual([
      expect.objectContaining({
        requestId: "child-approval",
        responseSession: target("child-thread"),
      }),
    ]);
  });

  test("keeps overlapping request ids isolated by normalized session identity", () => {
    const tasks = taskSessionRecords(
      { taskId: "task-1", record: record("thread-1") },
      { taskId: "task-2", record: record("thread-2") },
    );
    const approval = {
      requestId: "opaque-overlap",
      requestType: "command_execution" as const,
      title: "Run command",
    };
    const initial = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("thread-1", { pendingApprovals: [approval] }),
        snapshot("thread-2", { pendingApprovals: [approval] }),
      ],
    });

    const next = applyAgentSessionLiveDelta({
      current: initial,
      taskSessionRecords: tasks,
      envelope: {
        type: "session_upsert",
        session: snapshot("thread-1", { pendingApprovals: [] }),
      },
    });

    expect(getAgentSession(next, identity("thread-1"))?.pendingApprovals).toEqual([]);
    expect(getAgentSession(next, identity("thread-2"))?.pendingApprovals).toEqual([approval]);
  });

  test("applies authoritative lifecycle status from a live upsert after reload", () => {
    const tasks = taskSessionRecords({ taskId: "task-1", record: record("thread-1") });
    const initial = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [snapshot("thread-1")],
    });
    const current = getAgentSession(initial, identity("thread-1"));
    if (!current) {
      throw new Error("Expected projected session.");
    }
    const transcriptMarkedRunning = replaceAgentSession(initial, {
      ...current,
      status: "running",
    });

    const afterIdleSnapshot = applyAgentSessionLiveDelta({
      current: transcriptMarkedRunning,
      taskSessionRecords: tasks,
      envelope: {
        type: "session_upsert",
        session: snapshot("thread-1", { activity: "idle" }),
      },
    });

    expect(getAgentSession(afterIdleSnapshot, identity("thread-1"))?.status).toBe("idle");
  });

  test("keeps an accepted OpenCode send until runtime activity makes idle authoritative", () => {
    const opencodeIdentity = {
      runtimeKind: "opencode" as const,
      workingDirectory,
      externalSessionId: "thread-1",
    };
    const tasks = taskSessionRecords({
      taskId: "task-1",
      record: record("thread-1", { runtimeKind: "opencode" }),
    });
    const loaded = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      taskSessionRecords: tasks,
      snapshots: [
        snapshot("thread-1", {
          ref: { repoPath, ...opencodeIdentity },
        }),
      ],
    });
    const current = getAgentSession(loaded, opencodeIdentity);
    if (!current) {
      throw new Error("Expected projected OpenCode session.");
    }
    const acceptedSession = {
      ...current,
      status: "running" as const,
      pendingUserMessageStartedAt: Date.parse("2026-07-16T08:00:01.000Z"),
    };
    const afterAcceptedSend = replaceAgentSession(loaded, acceptedSession);
    const staleIdleSnapshot = snapshot("thread-1", {
      ref: { repoPath, ...opencodeIdentity },
    });

    const afterIdleDelta = applyAgentSessionLiveDelta({
      current: afterAcceptedSend,
      taskSessionRecords: tasks,
      envelope: { type: "session_upsert", session: staleIdleSnapshot },
    });
    const afterIdleReconnect = buildAgentSessionLiveCollection({
      current: afterAcceptedSend,
      taskSessionRecords: tasks,
      snapshots: [staleIdleSnapshot],
    });
    const afterRuntimeActivity = replaceAgentSession(afterAcceptedSend, {
      ...acceptedSession,
      messages: createSessionMessagesState("thread-1", [
        {
          id: "assistant-live-1",
          role: "assistant",
          content: "Runtime output",
          timestamp: "2026-07-16T08:00:02.000Z",
        },
      ]),
    });
    const afterActiveIdleReconnect = buildAgentSessionLiveCollection({
      current: afterRuntimeActivity,
      taskSessionRecords: tasks,
      snapshots: [staleIdleSnapshot],
    });
    const afterAbsentReconnect = buildAgentSessionLiveCollection({
      current: afterAcceptedSend,
      taskSessionRecords: tasks,
      snapshots: [],
    });
    const afterLiveRemoval = applyAgentSessionLiveDelta({
      current: afterAcceptedSend,
      taskSessionRecords: tasks,
      envelope: { type: "session_removed", ref: staleIdleSnapshot.ref },
    });

    expect(getAgentSession(afterIdleDelta, opencodeIdentity)).toMatchObject({
      status: "running",
      pendingUserMessageStartedAt: Date.parse("2026-07-16T08:00:01.000Z"),
    });
    expect(getAgentSession(afterIdleReconnect, opencodeIdentity)).toMatchObject({
      status: "running",
      pendingUserMessageStartedAt: Date.parse("2026-07-16T08:00:01.000Z"),
    });
    expect(getAgentSession(afterActiveIdleReconnect, opencodeIdentity)).toMatchObject({
      status: "idle",
      pendingUserMessageStartedAt: undefined,
    });
    expect(getAgentSession(afterAbsentReconnect, opencodeIdentity)).toMatchObject({
      status: "idle",
      pendingUserMessageStartedAt: undefined,
    });
    expect(getAgentSession(afterLiveRemoval, opencodeIdentity)).toMatchObject({
      status: "idle",
      pendingUserMessageStartedAt: undefined,
    });
  });

  test.each(["stopped", "error"] as const)(
    "does not resurrect a session after terminal %s activity",
    (terminalStatus) => {
      const tasks = taskSessionRecords({ taskId: "task-1", record: record("thread-1") });
      const loaded = buildAgentSessionLiveCollection({
        current: emptyAgentSessionCollection(),
        taskSessionRecords: tasks,
        snapshots: [snapshot("thread-1")],
      });
      const removed = applyAgentSessionLiveDelta({
        current: loaded,
        taskSessionRecords: tasks,
        envelope: {
          type: "session_removed",
          ref: snapshot("thread-1").ref,
        },
      });
      const current = getAgentSession(removed, identity("thread-1"));
      if (!current) {
        throw new Error("Expected projected session.");
      }
      const terminal = replaceAgentSession(removed, { ...current, status: terminalStatus });

      const afterIdle = applyAgentSessionLiveDelta({
        current: terminal,
        taskSessionRecords: tasks,
        envelope: {
          type: "session_upsert",
          session: snapshot("thread-1", {
            activity: "idle",
            pendingApprovals: [
              {
                requestId: "stale-approval",
                requestType: "command_execution",
                title: "Stale approval",
              },
            ],
          }),
        },
      });

      expect(getAgentSession(afterIdle, identity("thread-1"))).toEqual(
        expect.objectContaining({
          status: terminalStatus,
          pendingApprovals: [],
          pendingQuestions: [],
        }),
      );
    },
  );
});
