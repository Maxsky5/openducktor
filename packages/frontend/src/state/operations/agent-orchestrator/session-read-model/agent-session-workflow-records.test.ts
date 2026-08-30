import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot, AgentSessionRecord } from "@openducktor/contracts";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import {
  applyAgentSessionLiveDelta,
  buildAgentSessionLiveCollection,
} from "./agent-session-live-projection";
import {
  applyWorkflowSessionRecords,
  type LoadedWorkflowSessionRecords,
  pruneVanishedWorkflowSessions,
} from "./agent-session-workflow-records";

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

const loadedRecords = (
  ...entries: Array<{ taskId: string; record: AgentSessionRecord }>
): LoadedWorkflowSessionRecords => ({
  loadedTaskIds: new Set(entries.map(({ taskId }) => taskId)),
  records: entries,
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

const identity = (
  externalSessionId: string,
  overrides: Partial<AgentSessionIdentity> = {},
): AgentSessionIdentity => ({
  runtimeKind: "codex",
  workingDirectory,
  externalSessionId,
  ...overrides,
});

const projectAndApplyRecords = ({
  current = emptyAgentSessionCollection(),
  snapshots,
  records: loadedRecords,
}: {
  current?: AgentSessionCollection;
  snapshots: AgentSessionLiveSnapshot[];
  records: LoadedWorkflowSessionRecords;
}) =>
  applyWorkflowSessionRecords({
    projected: buildAgentSessionLiveCollection({ current, snapshots }),
    records: loadedRecords,
    associationEvidence: current,
  });

const applyRecordsOnly = ({
  projected,
  records: loadedRecords,
}: {
  projected: AgentSessionCollection;
  records: LoadedWorkflowSessionRecords;
}) =>
  applyWorkflowSessionRecords({
    projected,
    records: loadedRecords,
    associationEvidence: projected,
  });

describe("agent session workflow records", () => {
  test("restores a historical workflow session when no live runtime session exists", () => {
    const sessions = applyRecordsOnly({
      projected: emptyAgentSessionCollection(),
      records: loadedRecords({
        taskId: "task-1",
        record: record("thread-1", { role: "qa" }),
      }),
    });

    expect(getAgentSession(sessions, identity("thread-1"))).toMatchObject({
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "qa" },
      status: "idle",
      title: "QA task-1",
    });
  });

  test("applies persisted fields onto the matching live session without replacing live-owned fields", () => {
    const projected = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [
        snapshot("thread-1", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
          title: "Runtime title",
          contextUsage: { totalTokens: 900 },
        }),
      ],
    });
    const sessions = applyRecordsOnly({
      projected,
      records: loadedRecords({
        taskId: "task-1",
        record: record("thread-1", {
          startedAt: "2026-07-01T08:00:00.000Z",
          selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
        }),
      }),
    });

    expect(getAgentSession(sessions, identity("thread-1"))).toMatchObject({
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      title: "Runtime title",
      status: "idle",
      contextUsage: { totalTokens: 900 },
      startedAt: "2026-07-01T08:00:00.000Z",
      selectedModel: { providerId: "openai", modelId: "gpt-5" },
    });
  });

  test("rejects a persisted repository-to-workflow scope change", () => {
    const projected = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [snapshot("thread-1", { sessionAssociation: { kind: "repository" } })],
    });

    expect(() =>
      applyRecordsOnly({
        projected,
        records: loadedRecords({ taskId: "task-1", record: record("thread-1") }),
      }),
    ).toThrow(
      "Cannot reconcile persisted session 'thread-1' because its registered repository scope does not match the incoming workflow scope for task 'task-1' and role 'build'.",
    );
  });

  test("preserves omitted repository scope as record-reconciliation evidence", () => {
    const current = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [snapshot("thread-1", { sessionAssociation: { kind: "repository" } })],
    });
    const projected = buildAgentSessionLiveCollection({ current, snapshots: [] });

    expect(() =>
      applyWorkflowSessionRecords({
        projected,
        records: loadedRecords({ taskId: "task-1", record: record("thread-1") }),
        associationEvidence: current,
      }),
    ).toThrow(
      "Cannot reconcile persisted session 'thread-1' because its registered repository scope does not match the incoming workflow scope for task 'task-1' and role 'build'.",
    );
  });

  test("uses omitted unbound scope as evidence without retaining stale live fields", () => {
    const current = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [
        snapshot("thread-1", {
          pendingApprovals: [
            {
              requestId: "stale-approval",
              requestType: "command_execution",
              title: "Stale command",
            },
          ],
        }),
      ],
    });
    const projected = buildAgentSessionLiveCollection({ current, snapshots: [] });

    const sessions = applyWorkflowSessionRecords({
      projected,
      records: loadedRecords({ taskId: "task-1", record: record("thread-1") }),
      associationEvidence: current,
    });

    expect(getAgentSession(sessions, identity("thread-1"))).toMatchObject({
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      liveReported: false,
      pendingApprovals: [],
    });
  });

  test("keeps a matching workflow scope from persisted records", () => {
    const projected = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [
        snapshot("thread-1", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ],
    });

    const next = applyRecordsOnly({
      projected,
      records: loadedRecords({ taskId: "task-1", record: record("thread-1") }),
    });

    expect(getAgentSession(next, identity("thread-1"))?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-1",
      role: "build",
    });
  });

  test("rejects a conflicting workflow scope from persisted records", () => {
    const projected = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [
        snapshot("thread-1", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        }),
      ],
    });

    expect(() =>
      applyRecordsOnly({
        projected,
        records: loadedRecords({ taskId: "task-2", record: record("thread-1") }),
      }),
    ).toThrow(
      "Cannot reconcile persisted session 'thread-1' because its registered workflow scope for task 'task-1' and role 'spec' does not match the incoming workflow scope for task 'task-2' and role 'build'.",
    );
  });

  test("hydrates an unbound live session into workflow scope and refreshes parent routing", () => {
    const projected = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
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

    const next = applyRecordsOnly({
      projected,
      records: loadedRecords({ taskId: "task-1", record: record("child-thread") }),
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

  test("applies workflow records onto one mixed snapshot with workflow, repository, and unbound sessions", () => {
    const sessions = projectAndApplyRecords({
      snapshots: [
        snapshot("live-workflow-thread", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
        snapshot("repository-thread", { sessionAssociation: { kind: "repository" } }),
        snapshot("unbound-thread"),
      ],
      records: loadedRecords(
        { taskId: "task-1", record: record("live-workflow-thread") },
        { taskId: "task-2", record: record("historical-thread", { role: "planner" }) },
      ),
    });

    const byExternalId = (externalSessionId: string) =>
      listAgentSessions(sessions).find(
        (session) => session.externalSessionId === externalSessionId,
      );
    expect(byExternalId("live-workflow-thread")).toMatchObject({
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    });
    expect(byExternalId("repository-thread")).toMatchObject({
      sessionAssociation: { kind: "repository" },
    });
    expect(byExternalId("unbound-thread")).toMatchObject({
      sessionAssociation: { kind: "unbound" },
    });
    expect(byExternalId("historical-thread")).toMatchObject({
      sessionAssociation: { kind: "workflow", taskId: "task-2", role: "planner" },
    });
  });

  test("a task refresh cannot remove repository or unbound sessions", () => {
    const composed = projectAndApplyRecords({
      snapshots: [
        snapshot("repository-thread", { sessionAssociation: { kind: "repository" } }),
        snapshot("unbound-thread"),
      ],
      records: loadedRecords(),
    });

    const refreshed = applyRecordsOnly({
      projected: composed,
      records: loadedRecords({ taskId: "task-1", record: record("other-thread") }),
    });

    expect(getAgentSession(refreshed, identity("repository-thread"))).not.toBeNull();
    expect(getAgentSession(refreshed, identity("unbound-thread"))).not.toBeNull();
  });

  test("a loaded workflow record that disappears removes only the matching historical projection", () => {
    const composed = projectAndApplyRecords({
      snapshots: [],
      records: loadedRecords(
        { taskId: "task-1", record: record("gone-thread") },
        { taskId: "task-2", record: record("kept-thread", { role: "qa" }) },
      ),
    });
    expect(getAgentSession(composed, identity("gone-thread"))).not.toBeNull();

    const refreshed = applyRecordsOnly({
      projected: composed,
      records: {
        loadedTaskIds: new Set(["task-1", "task-2"]),
        records: [{ taskId: "task-2", record: record("kept-thread", { role: "qa" }) }],
      },
    });

    expect(getAgentSession(refreshed, identity("gone-thread"))).toBeNull();
    expect(getAgentSession(refreshed, identity("kept-thread"))?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-2",
      role: "qa",
    });
  });

  test("an unloaded or failed task-record read does not prune state", () => {
    const composed = projectAndApplyRecords({
      snapshots: [
        snapshot("repository-thread", { sessionAssociation: { kind: "repository" } }),
        snapshot("unbound-thread"),
      ],
      records: loadedRecords(
        { taskId: "task-1", record: record("historical-thread") },
        { taskId: "task-2", record: record("another-historical", { role: "qa" }) },
      ),
    });

    const refreshedWithNoLoadedTasks = applyRecordsOnly({
      projected: composed,
      records: { loadedTaskIds: new Set(), records: [] },
    });

    expect(listAgentSessions(refreshedWithNoLoadedTasks)).toHaveLength(4);
    expect(
      getAgentSession(refreshedWithNoLoadedTasks, identity("historical-thread")),
    ).not.toBeNull();
    expect(
      getAgentSession(refreshedWithNoLoadedTasks, identity("another-historical")),
    ).not.toBeNull();
  });

  test("keeps a live workflow session across snapshot and task refresh while the runtime reports it", () => {
    const projected = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [
        snapshot("live-thread", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ],
    });
    expect(getAgentSession(projected, identity("live-thread"))?.liveReported).toBe(true);

    const afterSnapshotApply = applyWorkflowSessionRecords({
      projected,
      records: loadedRecords(),
      associationEvidence: projected,
    });
    expect(getAgentSession(afterSnapshotApply, identity("live-thread"))?.liveReported).toBe(true);

    const afterTaskRefresh = applyRecordsOnly({
      projected,
      records: { loadedTaskIds: new Set(["task-1"]), records: [] },
    });
    expect(getAgentSession(afterTaskRefresh, identity("live-thread"))).not.toBeNull();
  });

  test("a task refresh prunes a workflow projection the runtime stopped reporting", () => {
    const projected = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [
        snapshot("live-thread", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ],
    });
    // The runtime removed the session; the settled projection is no longer reported.
    const removed = applyAgentSessionLiveDelta({
      current: projected,
      envelope: { type: "session_removed", ref: snapshot("live-thread").ref },
    });
    expect(getAgentSession(removed, identity("live-thread"))?.liveReported).toBe(false);

    const afterTaskRefresh = applyRecordsOnly({
      projected: removed,
      records: { loadedTaskIds: new Set(["task-1"]), records: [] },
    });
    expect(getAgentSession(afterTaskRefresh, identity("live-thread"))).toBeNull();
  });

  test("protects a starting workflow session from record-disappearance pruning", () => {
    const composed = projectAndApplyRecords({
      snapshots: [
        snapshot("launching-thread", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ],
      records: loadedRecords(),
    });
    const launching = getAgentSession(composed, identity("launching-thread"));
    if (!launching) {
      throw new Error("Expected launching session.");
    }
    const markedStarting = replaceAgentSession(composed, { ...launching, status: "starting" });

    const refreshed = applyRecordsOnly({
      projected: markedStarting,
      records: loadedRecords(),
    });

    expect(getAgentSession(refreshed, identity("launching-thread"))?.status).toBe("starting");
  });

  test.each(["opencode", "codex", "claude"] as const)(
    "applies %s workflow records with the same association rules",
    (runtimeKind) => {
      const runtimeIdentity = identity(`${runtimeKind}-thread`, { runtimeKind });
      const sessions = projectAndApplyRecords({
        snapshots: [
          snapshot(`${runtimeKind}-thread`, {
            ref: {
              repoPath,
              runtimeKind,
              workingDirectory,
              externalSessionId: `${runtimeKind}-thread`,
            },
            sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
          }),
        ],
        records: loadedRecords({
          taskId: "task-1",
          record: record(`${runtimeKind}-thread`, { runtimeKind }),
        }),
      });

      expect(getAgentSession(sessions, runtimeIdentity)?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
    },
  );

  test("pruning vanished records never rewrites saved fields on surviving sessions", () => {
    const projected = buildAgentSessionLiveCollection({
      current: emptyAgentSessionCollection(),
      snapshots: [
        snapshot("live-thread", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ],
    });
    const liveSession = getAgentSession(projected, identity("live-thread"));
    if (!liveSession) {
      throw new Error("Expected live session.");
    }
    const editedModel = {
      runtimeKind: "codex" as const,
      providerId: "openai",
      modelId: "gpt-5-new",
    };
    const withUserModel = replaceAgentSession(projected, {
      ...liveSession,
      selectedModel: editedModel,
    });

    // Deltas only prune, so a stale cached record cannot revert the user's
    // in-memory model choice.
    const prunedOnly = pruneVanishedWorkflowSessions({
      projected: withUserModel,
      records: {
        loadedTaskIds: new Set(["task-1"]),
        records: [
          {
            taskId: "task-1",
            record: record("live-thread", {
              selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5-old" },
            }),
          },
        ],
      },
    });
    expect(getAgentSession(prunedOnly, identity("live-thread"))?.selectedModel).toEqual(
      editedModel,
    );

    // Snapshot and refresh commits keep applying saved fields (main parity).
    const fullApply = applyWorkflowSessionRecords({
      projected: withUserModel,
      records: {
        loadedTaskIds: new Set(["task-1"]),
        records: [
          {
            taskId: "task-1",
            record: record("live-thread", {
              selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5-old" },
            }),
          },
        ],
      },
      associationEvidence: withUserModel,
    });
    expect(getAgentSession(fullApply, identity("live-thread"))?.selectedModel).toMatchObject({
      providerId: "openai",
      modelId: "gpt-5-old",
    });
  });

  test("finishes deletion when a removal follows an already-applied record disappearance", () => {
    const withRecord = projectAndApplyRecords({
      snapshots: [
        snapshot("live-thread", {
          sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        }),
      ],
      records: loadedRecords({ taskId: "task-1", record: record("live-thread") }),
    });

    // A loaded task refresh proves the record disappeared while the runtime
    // still reports the session, so it stays.
    const refreshedWhileLive = applyRecordsOnly({
      projected: withRecord,
      records: { loadedTaskIds: new Set(["task-1"]), records: [] },
    });
    expect(getAgentSession(refreshedWhileLive, identity("live-thread"))?.liveReported).toBe(true);

    // The runtime withdraws live evidence; applying that delta against
    // the already-loaded records must finish the deletion without another query.
    const removed = applyAgentSessionLiveDelta({
      current: refreshedWhileLive,
      envelope: { type: "session_removed", ref: snapshot("live-thread").ref },
    });
    expect(getAgentSession(removed, identity("live-thread"))?.liveReported).toBe(false);
    const afterRemovalApply = applyRecordsOnly({
      projected: removed,
      records: { loadedTaskIds: new Set(["task-1"]), records: [] },
    });
    expect(getAgentSession(afterRemovalApply, identity("live-thread"))).toBeNull();
  });

  test("protects a locally launched session that has never been live-reported", () => {
    const launched = {
      externalSessionId: "launching-thread",
      title: "Launching",
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      runtimeKind: "codex",
      workingDirectory,
      status: "idle",
      runtimeStatusMessage: null,
      startedAt: "2026-07-16T08:00:00.000Z",
      historyLoadState: "not_requested",
      messages: createSessionMessagesState("launching-thread"),
      contextUsage: null,
      pendingApprovals: [],
      pendingQuestions: [],
      selectedModel: null,
    } as const satisfies AgentSessionState;
    const projected = replaceAgentSession(emptyAgentSessionCollection(), launched);

    // Any unrelated delta applies loaded records; the launch has not
    // landed a record yet and no runtime report arrived, so nothing
    // proves deletion.
    const refreshed = applyRecordsOnly({
      projected,
      records: { loadedTaskIds: new Set(["task-1"]), records: [] },
    });
    expect(getAgentSession(refreshed, identity("launching-thread"))).not.toBeNull();
  });

  test("keeps a snapshot-backed owner and its mirrors when its record moves away", () => {
    const composed = projectAndApplyRecords({
      snapshots: [
        snapshot("root-thread"),
        snapshot("owner-thread", {
          parentExternalSessionId: "root-thread",
          pendingApprovals: [
            {
              requestId: "owned-approval",
              requestType: "command_execution",
              title: "Owned command",
            },
          ],
        }),
      ],
      records: loadedRecords({ taskId: "task-1", record: record("owner-thread") }),
    });
    expect(getAgentSession(composed, identity("root-thread"))?.pendingApprovals).toHaveLength(1);

    const refreshed = applyRecordsOnly({
      projected: composed,
      records: loadedRecords({ taskId: "task-2", record: record("other-thread") }),
    });

    expect(getAgentSession(refreshed, identity("owner-thread"))).not.toBeNull();
    expect(getAgentSession(refreshed, identity("root-thread"))?.pendingApprovals).toEqual([
      expect.objectContaining({ requestId: "owned-approval" }),
    ]);
    expect(getAgentSession(refreshed, identity("other-thread"))?.sessionAssociation).toEqual({
      kind: "workflow",
      taskId: "task-2",
      role: "build",
    });
  });
});
