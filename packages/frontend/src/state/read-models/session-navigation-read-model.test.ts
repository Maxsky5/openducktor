import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, TaskCard, WorkspaceSession } from "@openducktor/contracts";
import type {
  WorkspaceSessionFault,
  WorkspaceSessionLiveFacts,
  WorkspaceSessionLiveState,
} from "@/features/workspace-activity/workspace-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import {
  buildSessionNavigationModel,
  type SessionNavigationEntry,
  type SessionNavigationRead,
  type SessionNavigationWorkspace,
  type SessionNavigationWorkspaceSources,
} from "./session-navigation-read-model";

const workspace = (workspaceId = "alpha"): SessionNavigationWorkspace => ({
  workspaceId,
  workspaceName: `Workspace ${workspaceId}`,
  repoPath: `/repos/${workspaceId}`,
  abbreviation: null,
  tileColor: null,
  iconDataUrl: null,
});

const record = (
  externalSessionId: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  runtimeKind: "codex",
  workingDirectory: "/repos/alpha",
  startedAt: "2026-09-30T08:00:00.000Z",
  selectedModel: null,
  ...overrides,
});

const chat = (id: string, overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repos/alpha" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: `Chat ${id}`,
  manualTitle: null,
  createdAt: Date.parse("2026-09-30T07:00:00.000Z"),
  updatedAt: Date.parse("2026-09-30T07:00:00.000Z"),
  archivedAt: null,
  ...overrides,
});

const facts = (overrides: Partial<WorkspaceSessionLiveFacts> = {}): WorkspaceSessionLiveFacts => ({
  activityState: "idle",
  pendingQuestion: false,
  pendingPermission: false,
  fault: null,
  statusUnavailableReason: null,
  ...overrides,
});

const key = (externalSessionId: string, workingDirectory = "/repos/alpha") =>
  agentSessionIdentityKey({ externalSessionId, runtimeKind: "codex", workingDirectory });

const ready = <Data>(data: Data): SessionNavigationRead<Data> => ({
  status: "ready",
  data,
  refreshError: null,
});

const liveReady = (
  entries: [string, WorkspaceSessionLiveFacts][] = [],
  faults: [string, WorkspaceSessionFault][] = [],
): WorkspaceSessionLiveState => ({
  kind: "ready",
  sessions: new Map(entries),
  faults: new Map(faults),
});

const statusReadFailure = (message: string): WorkspaceSessionFault => ({
  message,
  statusUnavailable: true,
});

const sources = ({
  tasks = [],
  sessionsByTask = {},
  chats = [],
  live = liveReady(),
  owner = workspace(),
}: {
  tasks?: TaskCard[];
  sessionsByTask?: Record<string, SessionNavigationRead<AgentSessionRecord[]>>;
  chats?: WorkspaceSession[];
  live?: WorkspaceSessionLiveState;
  owner?: SessionNavigationWorkspace;
}): SessionNavigationWorkspaceSources => ({
  workspace: owner,
  tasks: ready(tasks),
  taskSessions: new Map(Object.entries(sessionsByTask)),
  workspaceSessions: ready(chats),
  live,
});

const groupKeys = (entries: readonly SessionNavigationEntry[]) => entries.map((entry) => entry.key);

const groupsOf = (model: ReturnType<typeof buildSessionNavigationModel>) =>
  Object.fromEntries(model.groups.map((group) => [group.id, groupKeys(group.entries)]));

describe("Task grouping", () => {
  test("uses stored activity to pick an older role session after restart", () => {
    const input = sources({
      tasks: [createTaskCardFixture({ id: "task-1", status: "human_review" })],
      sessionsByTask: {
        "task-1": ready([
          record("builder", {
            startedAt: "2026-09-30T08:00:00.000Z",
            lastActivityAt: Date.parse("2026-09-30T13:00:00.000Z"),
          }),
          record("qa", { role: "qa", startedAt: "2026-09-30T10:00:00.000Z" }),
        ]),
      },
    });
    const grouped = buildSessionNavigationModel([input], "task");
    expect(groupsOf(grouped)).toEqual({
      needs_you: [],
      running: [],
      recent: [`task_session:alpha:${key("builder")}`],
    });
  });

  test.each([
    {
      ids: ["old-idle", "new-idle"],
      asking: [],
      running: [],
      needs: [],
      working: [],
      recent: ["old-idle"],
    },
    {
      ids: ["old-running", "new-running", "new-idle"],
      asking: [],
      running: ["old-running", "new-running"],
      needs: [],
      working: ["old-running"],
      recent: [],
    },
    {
      ids: ["question", "old-idle", "new-idle"],
      asking: ["question"],
      running: [],
      needs: ["question"],
      working: [],
      recent: [],
    },
    {
      ids: ["question", "permission", "old-running", "new-running", "new-idle"],
      asking: ["question", "permission"],
      running: ["old-running", "new-running"],
      needs: ["question", "permission"],
      working: ["old-running"],
      recent: [],
    },
  ] as const)(
    "keeps input requests and one current session: $ids",
    ({ ids, asking, running, needs, working, recent }) => {
      const records = {
        "old-idle": record("old-idle", {
          startedAt: "2026-09-30T06:00:00.000Z",
          lastActivityAt: Date.parse("2026-09-30T13:00:00.000Z"),
        }),
        "new-idle": record("new-idle", { startedAt: "2026-09-30T10:00:00.000Z" }),
        "old-running": record("old-running", {
          startedAt: "2026-09-30T08:00:00.000Z",
          lastActivityAt: Date.parse("2026-09-30T13:00:00.000Z"),
        }),
        "new-running": record("new-running", { startedAt: "2026-09-30T09:00:00.000Z" }),
        question: record("question", { startedAt: "2026-09-30T11:00:00.000Z" }),
        permission: record("permission", { startedAt: "2026-09-30T12:00:00.000Z" }),
      };
      const input = sources({
        tasks: [createTaskCardFixture({ id: "task-1", status: "in_progress" })],
        sessionsByTask: { "task-1": ready(ids.map((id) => records[id])) },
        live: liveReady([
          ...asking.map((id): [string, WorkspaceSessionLiveFacts] => [
            key(id),
            facts({
              activityState: "running",
              pendingQuestion: id === "question",
              pendingPermission: id === "permission",
            }),
          ]),
          ...running.map((id): [string, WorkspaceSessionLiveFacts] => [
            key(id),
            facts({
              activityState: "running",
            }),
          ]),
          [key("old-idle"), facts()],
        ]),
      });
      const model = buildSessionNavigationModel([input], "task");
      const sessionIds = (group: string) =>
        model.groups
          .find((candidate) => candidate.id === group)
          ?.entries.map((entry) =>
            entry.target.kind === "task_session" ? entry.target.identity.externalSessionId : null,
          )
          .sort();
      expect(sessionIds("needs_you")).toEqual([...needs].sort());
      expect(sessionIds("running")).toEqual([...working]);
      expect(sessionIds("recent")).toEqual([...recent]);
      expect(model.entryCount).toBe(needs.length + working.length + recent.length);
    },
  );

  test("groups by task within each workspace, keeps workspace chats separate, and uses task grouping by default", () => {
    const inputs = ["alpha", "beta"].map((id) =>
      sources({
        owner: workspace(id),
        tasks: [createTaskCardFixture({ id: "same-task" })],
        sessionsByTask: {
          "same-task": ready([
            record("first", {
              workingDirectory: `/repos/${id}`,
              startedAt: "2026-09-30T07:00:00.000Z",
            }),
            record("last", {
              workingDirectory: `/repos/${id}`,
              startedAt: "2026-09-30T08:00:00.000Z",
            }),
          ]),
        },
        chats: [chat("one"), chat("two")],
      }),
    );
    const model = buildSessionNavigationModel(inputs);
    const entries = model.groups.flatMap((group) => group.entries);
    expect(model.entryCount).toBe(6);
    expect(
      entries
        .filter((entry) => entry.target.kind === "task_session")
        .map((entry) => [
          entry.workspace.workspaceId,
          entry.target.kind === "task_session" && entry.target.identity.externalSessionId,
        ])
        .sort(),
    ).toEqual([
      ["alpha", "last"],
      ["beta", "last"],
    ]);
    expect(entries.filter((entry) => entry.target.kind === "workspace_session")).toHaveLength(4);
  });
});

describe("buildSessionNavigationModel", () => {
  test("removes all sessions of a closed task from every group and restores them when reopened", () => {
    const task = createTaskCardFixture({ id: "task-1", status: "in_progress" });
    const input = sources({
      tasks: [task],
      sessionsByTask: {
        "task-1": ready([record("asking"), record("working"), record("idle")]),
      },
      chats: [chat("keep")],
      live: liveReady([
        [key("asking"), facts({ activityState: "waiting_input", pendingQuestion: true })],
        [key("working"), facts({ activityState: "running" })],
      ]),
    });
    const before = buildSessionNavigationModel([input], "none");
    expect(before.groups.map((group) => group.entries.length)).toEqual([1, 1, 2]);

    const closed = buildSessionNavigationModel(
      [{ ...input, tasks: ready([{ ...task, status: "closed" }]) }],
      "none",
    );
    expect(groupsOf(closed)).toEqual({
      needs_you: [],
      running: [],
      recent: ["workspace_session:alpha:keep"],
    });
    expect(closed.entryCount).toBe(1);
    expect(groupsOf(buildSessionNavigationModel([input], "none"))).toEqual(groupsOf(before));
  });

  test("puts each entry in one group with Needs you before Running before Recent", () => {
    const task = createTaskCardFixture({
      id: "task-1",
      title: "Import tasks",
      status: "in_progress",
    });
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [task],
          sessionsByTask: {
            "task-1": ready([
              record("asking"),
              record("working", { role: "qa" }),
              record("done", { role: "planner" }),
            ]),
          },
          chats: [chat("permission"), chat("running"), chat("idle")],
          live: liveReady([
            [key("asking"), facts({ activityState: "waiting_input", pendingQuestion: true })],
            [key("working"), facts({ activityState: "running" })],
            [
              key("native-permission"),
              facts({ activityState: "waiting_input", pendingPermission: true }),
            ],
            [key("native-running"), facts({ activityState: "starting" })],
          ]),
        }),
      ],
      "none",
    );

    expect(model.groups.map((group) => group.id)).toEqual(["needs_you", "running", "recent"]);
    expect(groupsOf(model)).toEqual({
      needs_you: [`task_session:alpha:${key("asking")}`, "workspace_session:alpha:permission"],
      running: [`task_session:alpha:${key("working")}`, "workspace_session:alpha:running"],
      recent: [`task_session:alpha:${key("done")}`, "workspace_session:alpha:idle"],
    });
    expect(model.entryCount).toBe(6);
    const [asking] = model.groups[0]?.entries ?? [];
    expect(asking).toMatchObject({
      target: { kind: "task_session", workspaceId: "alpha", role: "build" },
      title: "Import tasks",
      runtimeKind: "codex",
      workflowTone: "waiting_input",
      attention: ["question"],
    });
  });

  test("keeps saved runtimes and role completion when live status is unavailable", () => {
    const completed = { required: true, canSkip: false, available: true, completed: true };
    const task = createTaskCardFixture({
      id: "finished",
      status: "human_review",
      agentWorkflows: {
        spec: { ...completed },
        planner: { ...completed },
        builder: { ...completed },
        qa: { ...completed },
      },
    });
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [task],
          sessionsByTask: {
            finished: ready([
              record("spec", { role: "spec", runtimeKind: "opencode" }),
              record("plan", { role: "planner", runtimeKind: "codex" }),
              record("build", { role: "build", runtimeKind: "claude" }),
              record("qa", { role: "qa", runtimeKind: "opencode" }),
            ]),
          },
          chats: [chat("claude", { runtimeKind: "claude" })],
          live: {
            kind: "unavailable",
            reason: "Stream closed.",
            sessions: new Map(),
            faults: new Map(),
          },
        }),
      ],
      "none",
    );

    const entries = model.groups.flatMap((group) => group.entries);
    for (const [role, runtimeKind] of [
      ["spec", "opencode"],
      ["planner", "codex"],
      ["build", "claude"],
      ["qa", "opencode"],
    ] as const) {
      expect(entries).toContainEqual(
        expect.objectContaining({
          target: expect.objectContaining({ kind: "task_session", role }),
          runtimeKind,
          workflowTone: "done",
          status: { kind: "unavailable", reason: "Stream closed." },
        }),
      );
    }
    expect(entries).toContainEqual(
      expect.objectContaining({
        target: { kind: "workspace_session", workspaceId: "alpha", sessionId: "claude" },
        runtimeKind: "claude",
        workflowTone: null,
      }),
    );
  });

  test("marks only the latest started session of a blocked task and keeps all its reasons", () => {
    const task = createTaskCardFixture({ id: "task-1", status: "blocked" });
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [task],
          sessionsByTask: {
            "task-1": ready([
              record("older", { startedAt: "2026-09-29T08:00:00.000Z" }),
              record("latest", { role: "qa", startedAt: "2026-09-30T08:00:00.000Z" }),
            ]),
          },
          live: liveReady([
            [key("latest"), facts({ activityState: "waiting_input", pendingPermission: true })],
          ]),
        }),
      ],
      "none",
    );

    expect(model.groups[0]?.entries).toEqual([
      expect.objectContaining({
        key: `task_session:alpha:${key("latest")}`,
        attention: ["permission", "blocked"],
      }),
    ]);
    expect(groupsOf(model).recent).toEqual([`task_session:alpha:${key("older")}`]);
  });

  test("adds a sessionless blocked task only after its session read succeeds empty", () => {
    const blocked = createTaskCardFixture({
      id: "blocked",
      title: "Resolve CI",
      status: "blocked",
    });
    const loading = createTaskCardFixture({ id: "loading", status: "blocked" });
    const failed = createTaskCardFixture({ id: "failed", status: "blocked" });
    const open = createTaskCardFixture({ id: "open", status: "open" });
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [blocked, loading, failed, open],
          sessionsByTask: {
            blocked: ready([]),
            loading: { status: "loading" },
            failed: { status: "error", message: "Session records are unavailable." },
            open: ready([]),
          },
        }),
      ],
      "none",
    );

    expect(model.groups[0]?.entries).toEqual([
      expect.objectContaining({
        target: { kind: "task", workspaceId: "alpha", taskId: "blocked", role: null },
        key: "task:alpha:blocked",
        title: "Resolve CI",
        runtimeKind: null,
        workflowTone: null,
        attention: ["blocked"],
        time: { kind: "none" },
      }),
    ]);
    expect(model.entryCount).toBe(1);
    expect(model.isLoading).toBe(true);
    expect(model.issues).toEqual([
      {
        workspace: workspace(),
        source: "task_sessions",
        message: "Session records are unavailable.",
      },
    ]);
  });

  test("does not add a sessionless blocked task from an empty list whose refresh failed", () => {
    const blocked = createTaskCardFixture({ id: "blocked", status: "blocked" });
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [blocked],
          sessionsByTask: {
            blocked: { status: "ready", data: [], refreshError: "Session records are locked." },
          },
        }),
      ],
      "none",
    );

    expect(model.entryCount).toBe(0);
    expect(model.issues).toEqual([
      { workspace: workspace(), source: "task_sessions", message: "Session records are locked." },
    ]);
  });

  test("orders by saved activity and uses creation dates for legacy records", () => {
    const task = createTaskCardFixture({ id: "task-1", status: "human_review" });
    const savedTime = Date.parse("2026-09-30T09:00:00.000Z");
    const recentTime = Date.parse("2026-09-30T11:00:00.000Z");
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [task],
          sessionsByTask: {
            "task-1": ready([
              record("native", {
                startedAt: "2026-09-01T08:00:00.000Z",
                lastActivityAt: savedTime,
              }),
              record("observed", {
                startedAt: "2026-09-01T08:00:00.000Z",
                lastActivityAt: recentTime,
              }),
              record("start-only", { startedAt: "2026-09-30T10:00:00.000Z" }),
            ]),
          },
          chats: [
            chat("chat", { lastActivityAt: Date.parse("2026-09-30T10:30:00.000Z") }),
            chat("legacy", { updatedAt: Date.parse("2026-10-01T12:00:00.000Z") }),
          ],
          live: liveReady([[key("observed"), facts()]]),
        }),
      ],
      "none",
    );

    const recent = model.groups[2]?.entries ?? [];
    expect(groupKeys(recent)).toEqual([
      `task_session:alpha:${key("observed")}`,
      "workspace_session:alpha:chat",
      `task_session:alpha:${key("start-only")}`,
      `task_session:alpha:${key("native")}`,
      "workspace_session:alpha:legacy",
    ]);
    expect(recent[0]?.time).toEqual({ kind: "activity", at: recentTime });
    expect(recent[2]?.time).toEqual({
      kind: "started",
      at: Date.parse("2026-09-30T10:00:00.000Z"),
    });
    expect(recent[4]?.time).toEqual({ kind: "started", at: chat("legacy").createdAt });
  });

  test("keeps known attention but no confirmed running or idle state when live status is lost", () => {
    const model = buildSessionNavigationModel(
      [
        sources({
          chats: [chat("asking"), chat("was-running")],
          live: {
            kind: "unavailable",
            reason: "Live stream closed.",
            faults: new Map(),
            sessions: new Map([
              [
                key("native-asking"),
                facts({ activityState: "waiting_input", pendingQuestion: true }),
              ],
              [key("native-was-running"), facts({ activityState: "running" })],
            ]),
          },
        }),
      ],
      "none",
    );

    expect(groupsOf(model)).toEqual({
      needs_you: ["workspace_session:alpha:asking"],
      running: [],
      recent: ["workspace_session:alpha:was-running"],
    });
    expect(model.groups[2]?.entries[0]?.status).toEqual({
      kind: "unavailable",
      reason: "Live stream closed.",
    });
    expect(model.issues).toEqual([
      { workspace: workspace(), source: "live_status", message: "Live stream closed." },
    ]);
  });

  test("keeps a session fault on its entry when the session has no live facts", () => {
    const task = createTaskCardFixture({ id: "task-1", status: "in_progress" });
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [task],
          sessionsByTask: { "task-1": ready([record("faulted")]) },
          chats: [chat("faulted-chat")],
          live: liveReady(
            [],
            [
              [key("faulted"), statusReadFailure("Session refresh failed.")],
              [key("native-faulted-chat"), statusReadFailure("Chat refresh failed.")],
            ],
          ),
        }),
      ],
      "none",
    );

    expect(
      model.groups[2]?.entries.map((entry) => [entry.title, entry.status, entry.fault]),
    ).toEqual([
      [
        task.title,
        { kind: "unavailable", reason: "Session refresh failed." },
        "Session refresh failed.",
      ],
      [
        "Chat faulted-chat",
        { kind: "unavailable", reason: "Chat refresh failed." },
        "Chat refresh failed.",
      ],
    ]);
  });

  test("reports unknown status after a failed status read even when an older snapshot stays", () => {
    const task = createTaskCardFixture({ id: "task-1", status: "in_progress" });
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [task],
          sessionsByTask: { "task-1": ready([record("stale"), record("asking")]) },
          live: liveReady([
            [
              key("stale"),
              facts({
                activityState: "running",
                statusUnavailableReason: "Session refresh failed.",
              }),
            ],
            [
              key("asking"),
              facts({
                activityState: "waiting_input",
                pendingQuestion: true,
                statusUnavailableReason: "Session refresh failed.",
              }),
            ],
          ]),
        }),
      ],
      "none",
    );

    expect(groupsOf(model)).toEqual({
      needs_you: [`task_session:alpha:${key("asking")}`],
      running: [],
      recent: [`task_session:alpha:${key("stale")}`],
    });
    expect(model.groups[2]?.entries[0]).toMatchObject({
      status: { kind: "unavailable", reason: "Session refresh failed." },
    });
  });

  test("keeps the live status when a session fault does not affect it", () => {
    const task = createTaskCardFixture({ id: "task-1", status: "in_progress" });
    const model = buildSessionNavigationModel(
      [
        sources({
          tasks: [task],
          sessionsByTask: { "task-1": ready([record("busy"), record("idle")]) },
          live: liveReady(
            [[key("busy"), facts({ activityState: "running", fault: "Title update failed." })]],
            [
              [key("busy"), { message: "Title update failed.", statusUnavailable: false }],
              [key("idle"), { message: "Session save failed.", statusUnavailable: false }],
            ],
          ),
        }),
      ],
      "none",
    );

    expect(model.groups[1]?.entries[0]).toMatchObject({
      status: { kind: "running" },
      fault: "Title update failed.",
    });
    expect(model.groups[2]?.entries[0]).toMatchObject({
      status: { kind: "settled", failed: false },
      fault: "Session save failed.",
    });
  });

  test("reports loading live status as a status check", () => {
    const model = buildSessionNavigationModel(
      [sources({ chats: [chat("chat")], live: { kind: "unknown" } })],
      "none",
    );

    expect(model.groups[2]?.entries[0]?.status).toEqual({ kind: "checking" });
    expect(model.issues).toEqual([]);
  });

  test("keeps entries from separate workspaces apart and excludes archived chats", () => {
    const beta = workspace("beta");
    const model = buildSessionNavigationModel(
      [
        sources({ chats: [chat("same"), chat("archived", { archivedAt: 1 })] }),
        sources({ owner: beta, chats: [chat("same")] }),
      ],
      "none",
    );

    expect(groupsOf(model).recent).toEqual([
      "workspace_session:alpha:same",
      "workspace_session:beta:same",
    ]);
  });

  test("keeps the last chats when their refresh fails and reports the failure", () => {
    const model = buildSessionNavigationModel(
      [
        {
          ...sources({}),
          workspaceSessions: {
            status: "ready",
            data: [chat("kept")],
            refreshError: "Chat refresh failed.",
          },
        },
      ],
      "none",
    );

    expect(groupsOf(model).recent).toEqual(["workspace_session:alpha:kept"]);
    expect(model.issues).toEqual([
      { workspace: workspace(), source: "workspace_sessions", message: "Chat refresh failed." },
    ]);
  });

  test("reports failed sources per workspace and keeps the other results", () => {
    const failing: SessionNavigationWorkspaceSources = {
      ...sources({ owner: workspace("beta") }),
      tasks: { status: "error", message: "Task store is locked." },
      workspaceSessions: { status: "error", message: "Chats are unavailable." },
    };
    const model = buildSessionNavigationModel(
      [sources({ chats: [chat("kept")] }), failing],
      "none",
    );

    expect(groupsOf(model).recent).toEqual(["workspace_session:alpha:kept"]);
    expect(model.issues).toEqual([
      { workspace: workspace("beta"), source: "tasks", message: "Task store is locked." },
      {
        workspace: workspace("beta"),
        source: "workspace_sessions",
        message: "Chats are unavailable.",
      },
    ]);
    expect(model.isLoading).toBe(false);
  });
});
