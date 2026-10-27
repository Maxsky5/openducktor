import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord, WorkspaceSession } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import {
  buildSessionNavigationModel,
  type SessionNavigationRead,
  type SessionNavigationWorkspace,
  type SessionNavigationWorkspaceSources,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import type {
  WorkspaceSessionLiveFacts,
  WorkspaceSessionLiveState,
} from "@openducktor/frontend-core/workspace-activity/workspace-activity-state";
import {
  buildSessionListItems,
  parseSessionMenuAction,
  sessionEntryDestination,
  sessionEntryDotColor,
  sessionEntryIconColor,
  sessionEntryTitleColor,
  sessionMatchesQuery,
  sessionMenuItems,
  sessionRowAccessibleLabel,
  sessionRowSurface,
  sessionsNeedsYouCount,
  sessionsScreenState,
} from "./session-list-model";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const OPEN = { collapsed: new Set<never>(), query: "" };
const minutesAgo = (minutes: number): number => NOW - minutes * 60_000;

const workspace = (id: string): SessionNavigationWorkspace => ({
  workspaceId: id,
  workspaceName: `Workspace ${id}`,
  repoPath: `/repos/${id}`,
  abbreviation: null,
  tileColor: null,
  iconDataUrl: null,
});

const ready = <Data>(data: Data): SessionNavigationRead<Data> => ({
  status: "ready",
  data,
  refreshError: null,
});

const record = (
  workspaceId: string,
  externalSessionId: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  runtimeKind: "codex",
  workingDirectory: `/repos/${workspaceId}`,
  startedAt: "2026-10-19T08:00:00.000Z",
  selectedModel: null,
  ...overrides,
});

const chat = (
  workspaceId: string,
  id: string,
  overrides: Partial<WorkspaceSession> = {},
): WorkspaceSession => ({
  id,
  runtimeKind: "claude",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: `/repos/${workspaceId}` },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: `Chat ${id}`,
  manualTitle: null,
  createdAt: minutesAgo(600),
  updatedAt: minutesAgo(600),
  archivedAt: null,
  targetBranch: null,
  ...overrides,
});

const facts = (overrides: Partial<WorkspaceSessionLiveFacts> = {}): WorkspaceSessionLiveFacts => ({
  activityState: "idle",
  pendingQuestion: false,
  pendingPermission: false,
  pendingInputs: new Set(),
  fault: null,
  statusUnavailableReason: null,
  ...overrides,
});

const liveKey = (
  externalSessionId: string,
  runtimeKind: "codex" | "claude",
  workingDirectory: string,
): string => agentSessionIdentityKey({ externalSessionId, runtimeKind, workingDirectory });

const live = (entries: [string, WorkspaceSessionLiveFacts][]): WorkspaceSessionLiveState => ({
  kind: "ready",
  sessions: new Map(entries),
  faults: new Map(),
});

const sources = ({
  id,
  tasks = [],
  sessionsByTask = {},
  chats = [],
  liveState = live([]),
}: {
  id: string;
  tasks?: TaskCard[];
  sessionsByTask?: Record<string, AgentSessionRecord[]>;
  chats?: WorkspaceSession[];
  liveState?: WorkspaceSessionLiveState;
}): SessionNavigationWorkspaceSources => ({
  workspace: workspace(id),
  tasks: ready(tasks),
  taskSessions: new Map(
    Object.entries(sessionsByTask).map(([taskId, records]) => [taskId, ready(records)]),
  ),
  workspaceSessions: ready(chats),
  live: liveState,
});

/** Two open workspaces with attention, running work, and settled work in both. */
const mergedModel = () =>
  buildSessionNavigationModel(
    [
      sources({
        id: "alpha",
        tasks: [
          createTaskCardFixture({ id: "alpha-blocked", title: "Blocked alone", status: "blocked" }),
          createTaskCardFixture({ id: "alpha-build", title: "Build login", status: "in_progress" }),
        ],
        sessionsByTask: {
          "alpha-blocked": [],
          "alpha-build": [record("alpha", "build-1", { lastActivityAt: minutesAgo(5) })],
        },
        chats: [chat("alpha", "idle-chat", { lastActivityAt: minutesAgo(30) })],
        liveState: live([
          [liveKey("build-1", "codex", "/repos/alpha"), facts({ activityState: "running" })],
        ]),
      }),
      sources({
        id: "beta",
        tasks: [
          createTaskCardFixture({ id: "beta-blocked", title: "Blocked task", status: "blocked" }),
        ],
        sessionsByTask: {
          "beta-blocked": [
            record("beta", "older", {
              startedAt: "2026-10-18T08:00:00.000Z",
              lastActivityAt: minutesAgo(200),
            }),
            record("beta", "latest", { role: "qa", lastActivityAt: minutesAgo(90) }),
          ],
        },
        chats: [
          chat("beta", "asking", { lastActivityAt: minutesAgo(2) }),
          chat("beta", "fresh", { externalSessionId: null, lastActivityAt: minutesAgo(1) }),
        ],
        liveState: live([
          [
            liveKey("native-asking", "claude", "/repos/beta"),
            facts({ activityState: "waiting_input", pendingPermission: true }),
          ],
        ]),
      }),
    ],
    "task",
  );

describe("buildSessionListItems", () => {
  test("merges all open workspaces into Needs you, Running, and Recent in desktop order", () => {
    const items = buildSessionListItems(mergedModel(), OPEN);
    expect(
      items.map((item) =>
        item.type === "entry" ? `${item.groupId}:${item.entry.title}` : item.key,
      ),
    ).toEqual([
      "header:needs_you",
      // Newest known time first; entries without a time follow.
      "needs_you:Chat asking",
      "needs_you:Blocked task",
      "needs_you:Blocked alone",
      "header:running",
      "running:Build login",
      "header:recent",
      "recent:Chat fresh",
      "recent:Chat idle-chat",
    ]);
  });

  test("counts Needs you items across workspaces for the tab badge", () => {
    expect(sessionsNeedsYouCount(mergedModel())).toBe(3);
    expect(sessionsNeedsYouCount(buildSessionNavigationModel([], "task"))).toBe(0);
  });

  test("always shows Needs you and Running, and Recent only with sessions", () => {
    const model = buildSessionNavigationModel(
      [
        sources({
          id: "alpha",
          chats: [chat("alpha", "work", { lastActivityAt: minutesAgo(1) })],
          liveState: live([
            [liveKey("native-work", "claude", "/repos/alpha"), facts({ activityState: "running" })],
          ]),
        }),
      ],
      "task",
    );
    expect(buildSessionListItems(model, OPEN).map((item) => item.key)).toEqual([
      "header:needs_you",
      "header:running",
      "workspace_session:alpha:work",
    ]);
  });

  test("shows source problems before the groups", () => {
    const model = buildSessionNavigationModel(
      [
        {
          ...sources({ id: "alpha" }),
          workspaceSessions: { status: "error", message: "Host timed out." },
        },
      ],
      "task",
    );
    expect(buildSessionListItems(model, OPEN)[0]).toEqual({
      type: "issue",
      key: "issue:alpha:workspace_sessions",
      issue: {
        workspace: workspace("alpha"),
        source: "workspace_sessions",
        message: "Host timed out.",
      },
    });
  });
});

describe("sessionEntryDestination", () => {
  const entryTitled = (title: string) => {
    const entry = mergedModel()
      .groups.flatMap((group) => group.entries)
      .find((candidate) => candidate.title === title);
    if (!entry) throw new Error(`No entry ${title}`);
    return entry;
  };

  // The title fills the navigation bar on the first frame of the push.
  test("opens a session with pending input at that input", () => {
    expect(sessionEntryDestination(entryTitled("Chat asking"))).toEqual({
      kind: "session",
      params: {
        workspaceId: "beta",
        externalSessionId: "native-asking",
        runtimeKind: "claude",
        workingDirectory: "/repos/beta",
        title: "Chat asking",
        focus: "pending-input",
      },
    });
  });

  test("opens the latest session of a Blocked task", () => {
    expect(sessionEntryDestination(entryTitled("Blocked task"))).toEqual({
      kind: "session",
      params: {
        workspaceId: "beta",
        externalSessionId: "latest",
        runtimeKind: "codex",
        workingDirectory: "/repos/beta",
        title: "Blocked task",
        task: "1",
      },
    });
  });

  test("opens task details for a Blocked task without a session", () => {
    expect(sessionEntryDestination(entryTitled("Blocked alone"))).toEqual({
      kind: "task",
      workspaceId: "alpha",
      taskId: "alpha-blocked",
    });
  });

  test("opens a running session without focus, and reports a chat that has not started", () => {
    expect(sessionEntryDestination(entryTitled("Build login"))).toEqual({
      kind: "session",
      params: {
        workspaceId: "alpha",
        externalSessionId: "build-1",
        runtimeKind: "codex",
        workingDirectory: "/repos/alpha",
        title: "Build login",
        task: "1",
      },
    });
    expect(sessionEntryDestination(entryTitled("Chat fresh"))).toEqual({ kind: "not_started" });
  });
});

describe("folding and search", () => {
  test("keeps the header of a folded group and hides its sessions", () => {
    const items = buildSessionListItems(mergedModel(), {
      collapsed: new Set(["needs_you"] as const),
      query: "",
    });
    expect(items[0]).toMatchObject({
      type: "header",
      groupId: "needs_you",
      count: 3,
      collapsed: true,
    });
    expect(items.some((item) => item.type === "entry" && item.groupId === "needs_you")).toBe(false);
    expect(items[1]).toMatchObject({ type: "header", groupId: "running", collapsed: false });
  });

  test("shows only the groups and sessions that match every search word", () => {
    const items = buildSessionListItems(mergedModel(), {
      collapsed: new Set(),
      query: "blocked BETA",
    });
    expect(
      items.map((item) =>
        item.type === "entry"
          ? item.entry.title
          : `${item.key}:${item.type === "header" ? item.count : ""}`,
      ),
    ).toEqual(["header:needs_you:1", "Blocked task"]);
  });

  test("matches the title, workspace, role, task ID, and chat folder", () => {
    const entries = mergedModel().groups.flatMap((group) => group.entries);
    const build = entries.find((entry) => entry.title === "Build login");
    const chatEntry = entries.find((entry) => entry.title === "Chat idle-chat");
    if (!build || !chatEntry) throw new Error("Missing entries");
    expect(sessionMatchesQuery(build, "builder")).toBe(true);
    expect(sessionMatchesQuery(build, "alpha-build")).toBe(true);
    expect(sessionMatchesQuery(build, "workspace alpha")).toBe(true);
    expect(sessionMatchesQuery(chatEntry, "/repos/alpha")).toBe(true);
    expect(sessionMatchesQuery(chatEntry, "beta")).toBe(false);
    expect(sessionMatchesQuery(chatEntry, "  ")).toBe(true);
  });
});

describe("row colors", () => {
  const entries = () => mergedModel().groups.flatMap((group) => group.entries);
  const titled = (title: string) => {
    const entry = entries().find((candidate) => candidate.title === title);
    if (!entry) throw new Error(`No entry ${title}`);
    return entry;
  };

  test("paint a session that needs you in the warning colors", () => {
    const asking = titled("Chat asking");
    expect(sessionRowSurface(asking)).toBe("attention");
    expect(sessionEntryIconColor(asking)).toBe("warningMuted");
    expect(sessionEntryTitleColor(asking, false)).toBe("warningMuted");
    expect(sessionEntryDotColor(asking, true)).toBe("statusInputUnread");
  });

  test("paint running work in the info colors", () => {
    const running = titled("Build login");
    expect(sessionRowSurface(running)).toBe("running");
    expect(sessionEntryIconColor(running)).toBe("infoMuted");
    expect(sessionEntryDotColor(running, false)).toBe("statusRunning");
  });

  test("dim a settled session that is read", () => {
    const idle = titled("Chat idle-chat");
    expect(sessionRowSurface(idle)).toBe("plain");
    expect(sessionEntryTitleColor(idle, false)).toBe("sidebarReadForeground");
    expect(sessionEntryTitleColor(idle, true)).toBe("foreground");
    expect(sessionEntryDotColor(idle, false)).toBe("statusRead");
  });
});

describe("sessionRowAccessibleLabel", () => {
  const entry = () => {
    const found = mergedModel()
      .groups.flatMap((group) => group.entries)
      .find((candidate) => candidate.title === "Chat idle-chat");
    if (!found) throw new Error("No entry Chat idle-chat");
    return found;
  };

  test("names the row only, when it has no command and is read", () => {
    const row = entry();
    const name = sessionRowAccessibleLabel(row, {
      commandCount: 0,
      unread: false,
      starting: false,
    });
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toContain("Unread");
  });

  test("adds the active commands, the unread state, and the start", () => {
    const row = entry();
    const name = sessionRowAccessibleLabel(row, {
      commandCount: 0,
      unread: false,
      starting: false,
    });
    expect(sessionRowAccessibleLabel(row, { commandCount: 1, unread: true, starting: true })).toBe(
      `${name}, 1 active command, Unread, Starting`,
    );
    expect(
      sessionRowAccessibleLabel(row, { commandCount: 2, unread: false, starting: false }),
    ).toBe(`${name}, 2 active commands`);
  });
});

describe("sessionMenuItems", () => {
  test("offer rename and archive only for a chat, as the desktop menu", () => {
    const entries = mergedModel().groups.flatMap((group) => group.entries);
    const chatEntry = entries.find((entry) => entry.title === "Chat idle-chat");
    const task = entries.find((entry) => entry.title === "Build login");
    const blocked = entries.find((entry) => entry.title === "Blocked alone");
    if (!chatEntry || !task || !blocked) throw new Error("Missing entries");
    expect(sessionMenuItems(chatEntry, true).map((item) => item.id)).toEqual([
      "toggle_read",
      "rename",
      "copy_working_directory",
      "copy_external_session_id",
      "archive",
    ]);
    expect(sessionMenuItems(chatEntry, true).map((item) => item.title)).toEqual([
      "Mark as Read",
      "Rename Chat",
      "Copy Working Directory",
      "Copy External Session ID",
      "Archive Chat",
    ]);
    expect(sessionMenuItems(task, false).map((item) => [item.id, item.disabled ?? false])).toEqual([
      ["toggle_read", false],
      ["copy_working_directory", false],
      ["copy_external_session_id", false],
    ]);
    expect(
      sessionMenuItems(blocked, false).map((item) => [item.id, item.disabled ?? false]),
    ).toEqual([
      ["toggle_read", false],
      ["copy_working_directory", true],
      ["copy_external_session_id", true],
    ]);
    expect(parseSessionMenuAction("archive")).toBe("archive");
    expect(parseSessionMenuAction("delete")).toBeNull();
  });
});

describe("sessionsScreenState", () => {
  const model = (patch: Partial<{ entryCount: number; isLoading: boolean; issues: never[] }>) => ({
    entryCount: 0,
    isLoading: false,
    issues: [],
    ...patch,
  });
  const state = (
    patch: Partial<Parameters<typeof sessionsScreenState>[0]> = {},
  ): ReturnType<typeof sessionsScreenState> =>
    sessionsScreenState({
      hostUnavailable: false,
      workspacesLoading: false,
      workspaceCount: 1,
      model: model({ entryCount: 2 }),
      ...patch,
    });

  test("shows the list while it has entries", () => {
    expect(state()).toBe("list");
  });

  test("shows the connection state for an empty list while the host is unavailable", () => {
    expect(state({ hostUnavailable: true, model: model({}) })).toBe("host_unavailable");
    expect(state({ hostUnavailable: true })).toBe("list");
  });

  test("loads while the workspaces or the first sessions load", () => {
    expect(state({ workspacesLoading: true })).toBe("loading");
    expect(state({ model: model({ isLoading: true }) })).toBe("loading");
  });

  test("asks for a workspace, then for a first session", () => {
    expect(state({ workspaceCount: 0 })).toBe("no_workspace");
    expect(state({ model: model({}) })).toBe("no_sessions");
  });
});
