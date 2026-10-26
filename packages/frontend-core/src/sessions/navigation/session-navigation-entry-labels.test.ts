import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import {
  sessionEntryAccessibleName,
  sessionEntryRoleLabel,
  sessionEntryRuntimeLabel,
  sessionEntryShortTime,
  sessionEntryStatusText,
  sessionEntryTimeText,
  sessionEntryTypeLabel,
  sessionSourceIssueText,
  visibleAttentionReasons,
  visibleSessionNavigationGroups,
} from "./session-navigation-entry-labels";
import type {
  SessionNavigationEntry,
  SessionNavigationWorkspace,
} from "./session-navigation-read-model";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

const workspace: SessionNavigationWorkspace = {
  workspaceId: "alpha",
  workspaceName: "Alpha",
  repoPath: "/repos/alpha",
  abbreviation: null,
  tileColor: null,
  iconDataUrl: null,
};

const chat: WorkspaceSession = {
  id: "chat",
  runtimeKind: "codex",
  externalSessionId: "native-chat",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repos/alpha" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: "Chat",
  manualTitle: null,
  createdAt: NOW - 60 * 60_000,
  updatedAt: NOW - 60 * 60_000,
  archivedAt: null,
  targetBranch: null,
};

const chatEntry = (overrides: Partial<SessionNavigationEntry> = {}): SessionNavigationEntry => ({
  key: "workspace_session:alpha:chat",
  target: { kind: "workspace_session", workspaceId: "alpha", sessionId: "chat" },
  workspace,
  title: "Chat",
  runtimeKind: "codex",
  workflowTone: null,
  startedAt: null,
  attention: [],
  status: { kind: "settled", failed: false },
  time: { kind: "activity", at: NOW - 28 * 60_000 },
  fault: null,
  context: { kind: "workspace", session: chat },
  ...overrides,
});

const task = createTaskCardFixture({ id: "task-1", status: "blocked" });

const taskSessionEntry = (overrides: Partial<SessionNavigationEntry> = {}) =>
  chatEntry({
    key: "task_session:alpha:asking",
    target: {
      kind: "task_session",
      workspaceId: "alpha",
      taskId: "task-1",
      role: "build",
      identity: {
        externalSessionId: "asking",
        runtimeKind: "codex",
        workingDirectory: "/repos/alpha",
      },
    },
    context: { kind: "task", task, sessions: [] },
    ...overrides,
  });

const blockedTaskEntry = chatEntry({
  key: "task:alpha:task-1",
  target: { kind: "task", workspaceId: "alpha", taskId: "task-1", role: null },
  runtimeKind: null,
  attention: ["blocked"],
  time: { kind: "none" },
  context: { kind: "task", task, sessions: [] },
});

describe("session navigation entry labels", () => {
  test("tells a status check apart from a lost status", () => {
    expect(sessionEntryStatusText(chatEntry({ status: { kind: "checking" } }))).toBe(
      "Checking status",
    );
    expect(
      sessionEntryStatusText(
        chatEntry({ status: { kind: "unavailable", reason: "Stream closed." } }),
      ),
    ).toBe("Status unavailable: Stream closed.");
    expect(sessionEntryStatusText(taskSessionEntry({ attention: ["question", "blocked"] }))).toBe(
      "Needs you: Question, Blocked",
    );
    expect(sessionEntryStatusText(chatEntry({ status: { kind: "running" } }))).toBe("Running");
    expect(sessionEntryStatusText(chatEntry({ status: { kind: "settled", failed: true } }))).toBe(
      "Last run failed",
    );
    expect(sessionEntryStatusText(chatEntry())).toBe("Idle");
  });

  test("does not present a start time as the latest activity", () => {
    expect(sessionEntryTimeText(chatEntry(), NOW)).toBe("Active 28m ago");
    expect(
      sessionEntryTimeText(taskSessionEntry({ time: { kind: "started", at: NOW - 30_000 } }), NOW),
    ).toBe("Started just now");
    expect(sessionEntryTimeText(blockedTaskEntry, NOW)).toBeNull();
    expect(sessionEntryShortTime(chatEntry(), NOW)).toBe("28m");
    expect(sessionEntryShortTime(blockedTaskEntry, NOW)).toBeNull();
  });

  test("names the entry type, workflow role, and runtime", () => {
    expect(sessionEntryTypeLabel(chatEntry())).toBe("Workspace session");
    expect(sessionEntryTypeLabel(taskSessionEntry())).toBe("Task session");
    expect(sessionEntryTypeLabel(blockedTaskEntry)).toBe("Blocked task");
    expect(sessionEntryRoleLabel(taskSessionEntry())).toBe("Builder");
    expect(sessionEntryRoleLabel(chatEntry())).toBeNull();
    expect(sessionEntryRuntimeLabel(chatEntry())).toBe("Codex");
    expect(sessionEntryRuntimeLabel(blockedTaskEntry)).toBeNull();
  });

  test("reads the title, type, workspace, state, task status, runtime, and fault", () => {
    expect(sessionEntryAccessibleName(taskSessionEntry({ attention: ["question"] }))).toBe(
      "Chat, Builder Task session, Alpha, Needs you: Question, Task status: Blocked needs input, Codex runtime",
    );
    expect(sessionEntryAccessibleName(chatEntry({ fault: "Stream lagged." }))).toBe(
      "Chat, Workspace session, Alpha, Idle, Codex runtime, Observation fault: Stream lagged.",
    );
  });

  test("names the workspace and the source of a failed read", () => {
    expect(
      sessionSourceIssueText({ workspace, source: "task_sessions", message: "Timed out." }),
    ).toBe("Alpha: Task sessions could not load. Timed out.");
  });

  test("shows Recent only when it has entries", () => {
    const groups = [
      { id: "needs_you" as const, entries: [] },
      { id: "running" as const, entries: [] },
      { id: "recent" as const, entries: [] },
    ];
    expect(visibleSessionNavigationGroups(groups).map((group) => group.id)).toEqual([
      "needs_you",
      "running",
    ]);
    expect(
      visibleSessionNavigationGroups([{ id: "recent", entries: [chatEntry()] }]).map(
        (group) => group.id,
      ),
    ).toEqual(["recent"]);
  });

  test("lets the task status badge of a blocked task replace its Blocked badge", () => {
    expect(
      visibleAttentionReasons(taskSessionEntry({ attention: ["question", "blocked"] })),
    ).toEqual(["question"]);
    expect(visibleAttentionReasons(chatEntry({ attention: ["blocked"] }))).toEqual(["blocked"]);
  });
});
