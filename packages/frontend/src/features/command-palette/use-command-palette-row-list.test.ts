import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { createElement } from "react";
import { workspaceSessionEntry } from "@/components/layout/sidebar/session-navigation.test-support";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import {
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import type { PaletteChatHandlers } from "./command-palette-chat-actions";
import type { PaletteTaskAction, PaletteTaskView } from "./command-palette-task-model";
import type { PaletteChat, PaletteTask } from "./command-palette-types";
import type { CommandPaletteMainList } from "./use-command-palette-main-list";
import { openRowOf, rowListOf } from "./use-command-palette-row-list";

const workspace = createWorkspaceRecordFixture();
const paletteTask = (title: string): PaletteTask => ({
  key: "task:w:odt-1",
  workspace,
  task: createTaskCardFixture({ id: "odt-1", title }),
});
const task = paletteTask("Polish the palette");
const session: WorkspaceSession = {
  id: "c-1",
  runtimeKind: "codex",
  externalSessionId: null,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: "Release notes",
  manualTitle: null,
  targetBranch: null,
  createdAt: 0,
  lastActivityAt: 0,
  updatedAt: 0,
  archivedAt: null,
};
const paletteChat = (title: string): PaletteChat => ({
  key: "chat:w:c-1",
  workspace,
  session,
  title,
});
const chat = paletteChat("Release notes");
const taskAction = (key: string, label: string): PaletteTaskAction => ({
  key,
  label,
  keywords: [],
  icon: createElement("span"),
  destructive: false,
  disabled: false,
  command: { kind: "edit" },
});
const taskView: PaletteTaskView = {
  open: { kind: "details" },
  sessionsNote: "Loading sessions…",
  nextStep: null,
  actions: [taskAction("edit", "Edit task"), taskAction("details", "Open task details")],
  sessionOptionsByRole: {},
};
const taskViewOf = (): PaletteTaskView => taskView;
const chatHandlers = (): PaletteChatHandlers => ({
  open: () => {},
  setUnread: () => {},
  rename: () => {},
  archive: () => {},
  copy: () => {},
});
const main: CommandPaletteMainList = {
  groups: [],
  entries: [],
  enabledValues: [],
  taskByKey: new Map([[task.key, task]]),
  chatByKey: new Map([[chat.key, chat]]),
};

describe("openRowOf", () => {
  test("is null for the main list and uses the latest data of an open row", () => {
    expect(openRowOf({ kind: "main" }, main)).toBeNull();

    const openedTask = openRowOf(
      { kind: "row", entry: { kind: "task", item: paletteTask("Old title") }, savedQuery: "" },
      main,
    );
    const openedChat = openRowOf(
      { kind: "row", entry: { kind: "chat", item: paletteChat("Old title") }, savedQuery: "" },
      main,
    );

    expect(openedTask).toEqual({ kind: "task", item: task });
    expect(openedChat).toEqual({ kind: "chat", item: chat });
  });
});

describe("rowListOf", () => {
  test("lists the task actions that match the query and runs each one as a task command", () => {
    const runTaskCommand = mock(() => {});

    const list = rowListOf(
      { kind: "task", item: task },
      {
        query: " edit ",
        sessionEntries: [],
        showReply: () => {},
        taskViewOf,
        runners: { runTaskCommand, chatHandlers },
        chatUnread: false,
      },
    );
    list.actions[0]?.run();

    expect(list.note).toBe("Loading sessions…");
    expect(list.actions.map((entry) => entry.key)).toEqual(["edit"]);
    expect(runTaskCommand).toHaveBeenCalledWith(task, { kind: "edit" }, taskView);
  });

  test("lists the chat actions that match the query", () => {
    const list = rowListOf(
      { kind: "chat", item: chat },
      {
        query: "copy",
        sessionEntries: [],
        showReply: () => {},
        taskViewOf,
        runners: { runTaskCommand: () => {}, chatHandlers },
        chatUnread: false,
      },
    );

    expect(list.note).toBeNull();
    expect(list.actions.map((entry) => entry.label)).toEqual([
      "Copy working directory",
      "Copy external session ID",
    ]);
  });

  test("puts a reply action first when a session of the row waits for an answer", () => {
    const showReply = mock(() => {});
    const replyLabel = (attention: SessionNavigationEntry["attention"][]) =>
      rowListOf(
        { kind: "chat", item: chat },
        {
          query: "",
          sessionEntries: attention.map((reasons, index) =>
            workspaceSessionEntry(`chat-${index}`, { attention: reasons }),
          ),
          showReply,
          taskViewOf,
          runners: { runTaskCommand: () => {}, chatHandlers },
          chatUnread: false,
        },
      ).actions[0];

    expect(replyLabel([["question"]])?.label).toBe("Reply to question");
    expect(replyLabel([["permission"]])?.label).toBe("Reply to permission request");
    expect(replyLabel([["question"], ["permission"]])?.label).toBe("Reply to requests");
    expect(replyLabel([["blocked"]])?.label).toBe("Open chat");
    replyLabel([["question"]])?.run();
    expect(showReply).toHaveBeenCalledWith({ kind: "chat", item: chat });
  });
});
