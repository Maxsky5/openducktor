import { describe, expect, test } from "bun:test";
import type { TaskCard, WorkspaceSession } from "@openducktor/contracts";
import {
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import { searchGroups } from "./command-palette-groups";
import { rankActions, rankChats, rankTasks, type ScoredMatch } from "./command-palette-search";
import type { PaletteAction, PaletteChat, PaletteTask } from "./command-palette-types";

const workspace = createWorkspaceRecordFixture();

const paletteTask = (task: Partial<TaskCard>): PaletteTask => {
  const card = createTaskCardFixture(task);
  return { key: `task:${workspace.workspaceId}:${card.id}`, workspace, task: card };
};

const paletteChat = (id: string, title: string, lastActivityAt: number): PaletteChat => ({
  key: `chat:${workspace.workspaceId}:${id}`,
  workspace,
  session: {
    id,
    runtimeKind: "codex",
    externalSessionId: `native-${id}`,
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: title,
    manualTitle: null,
    createdAt: 0,
    lastActivityAt,
    updatedAt: 0,
    archivedAt: null,
  } satisfies WorkspaceSession,
  title,
});

const action = (label: string, keywords: string[] = []): PaletteAction => ({
  key: `action:${label}`,
  label,
  workspaceName: null,
  icon: null,
  keywords,
  suggested: false,
  disabledReason: null,
  checked: false,
  run: () => {},
});

const labels = (matches: readonly ScoredMatch<PaletteAction>[]): string[] =>
  matches.map((match) => match.item.label);
const taskIds = (matches: readonly ScoredMatch<PaletteTask>[]): string[] =>
  matches.map((match) => match.item.task.id);

describe("command palette search", () => {
  test("finds actions by label and other words, ignoring case", () => {
    const actions = [
      action("New task", ["create task", "add task"]),
      action("Import chat from an external runtime", ["import session", "external session"]),
      action("Open settings", ["preferences"]),
    ];

    expect(labels(rankActions(actions, "CREATE"))[0]).toBe("New task");
    expect(labels(rankActions(actions, "import session"))[0]).toBe(
      "Import chat from an external runtime",
    );
    expect(labels(rankActions(actions, "prefs"))).toEqual(["Open settings"]);
    expect(rankActions(actions, "zzz")).toEqual([]);
  });

  test("finds tasks by title, partial title, task ID, and label", () => {
    const tasks = [
      paletteTask({ id: "odt-cmd", title: "Add a command palette", labels: ["ux"] }),
      paletteTask({ id: "odt-git", title: "Show git diff", labels: ["frontend"] }),
    ];

    expect(taskIds(rankTasks(tasks, "cmd palette"))).toEqual(["odt-cmd"]);
    expect(taskIds(rankTasks(tasks, "odt-git"))[0]).toBe("odt-git");
    expect(taskIds(rankTasks(tasks, "frontend"))).toEqual(["odt-git"]);
  });

  test("puts a task that is not closed before an equal closed task, then the latest update", () => {
    const tasks = [
      paletteTask({ id: "closed", title: "Fix login", status: "closed" }),
      paletteTask({ id: "old", title: "Fix login", updatedAt: "2026-01-01T00:00:00.000Z" }),
      paletteTask({ id: "new", title: "Fix login", updatedAt: "2026-02-01T00:00:00.000Z" }),
    ];

    expect(taskIds(rankTasks(tasks, "fix login"))).toEqual(["new", "old", "closed"]);
  });

  test("orders equal chats by the latest activity", () => {
    const chats = [paletteChat("a", "Release notes", 1), paletteChat("b", "Release notes", 2)];

    expect(rankChats(chats, "release").map((match) => match.item.session.id)).toEqual(["b", "a"]);
  });

  test("puts the group with the best match first and keeps the default order on ties", () => {
    const newTask = action("New task");
    const task = paletteTask({ id: "odt-1", title: "New task flow" });
    const chat = paletteChat("c", "New task ideas", 1);

    const ordered = searchGroups({
      actions: [{ item: newTask, score: 0.2 }],
      tasks: [{ item: task, score: 0.9 }],
      chats: [{ item: chat, score: 0.5 }],
    });
    const tied = searchGroups({
      actions: [{ item: newTask, score: 0.5 }],
      tasks: [{ item: task, score: 0.5 }],
      chats: [{ item: chat, score: 0.5 }],
    });

    expect(ordered.map((group) => group.id)).toEqual(["tasks", "chats", "actions"]);
    expect(tied.map((group) => group.id)).toEqual(["actions", "tasks", "chats"]);
  });

  test("drops scattered letter matches when a strong match exists", () => {
    const themeAction = action("Theme: Dark", ["theme", "appearance"]);
    const actions = [
      themeAction,
      action("Go to Kanban", ["board", "tasks", "home", "open kanban"]),
    ];

    const groups = searchGroups({
      actions: rankActions(actions, "theme"),
      tasks: [],
      chats: [],
    });

    expect(rankActions(actions, "theme")).toHaveLength(2);
    expect(groups).toEqual([
      { id: "actions", heading: "Actions", entries: [{ kind: "action", item: themeAction }] },
    ]);
  });

  test("keeps a weak match when nothing matches better", () => {
    const task = paletteTask({ id: "odt-3", title: "Add a command palette" });

    expect(
      searchGroups({ actions: [], tasks: rankTasks([task], "cmd palette"), chats: [] }),
    ).toEqual([{ id: "tasks", heading: "Tasks", entries: [{ kind: "task", item: task }] }]);
  });
});
