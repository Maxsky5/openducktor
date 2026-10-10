import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import {
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import type { PaletteEntry } from "./command-palette-groups";
import type { PaletteTaskAction, PaletteTaskView } from "./command-palette-task-model";
import type { PaletteAction, PaletteRowAction, PaletteTask } from "./command-palette-types";
import type { CommandPaletteMainList } from "./use-command-palette-main-list";
import { highlightOf } from "./use-command-palette-navigation";
import type { PaletteRowList } from "./use-command-palette-row-list";

const workspace = createWorkspaceRecordFixture();
const paletteTask = (title: string): PaletteTask => ({
  key: "task:w:odt-1",
  workspace,
  task: createTaskCardFixture({ id: "odt-1", title }),
});
const task = paletteTask("Polish the palette");
const action: PaletteAction = {
  key: "action:new-task",
  label: "New task",
  workspaceName: workspace.workspaceName,
  icon: null,
  keywords: [],
  suggested: true,
  disabledReason: null,
  checked: false,
  run: () => {},
};
const taskAction = (key: string, label: string, disabled = false): PaletteTaskAction => ({
  key,
  label,
  keywords: [],
  icon: createElement("span"),
  destructive: false,
  disabled,
  command: { kind: "edit" },
});
const rowAction = (key: string, disabled = false): PaletteRowAction => ({
  ...taskAction(key, key, disabled),
  run: () => {},
});
const taskView: PaletteTaskView = {
  open: { kind: "details" },
  sessionsNote: "Loading sessions…",
  nextStep: null,
  actions: [taskAction("edit", "Edit task"), taskAction("details", "Open task details")],
  sessionOptionsByRole: {},
};
const taskViewOf = (): PaletteTaskView => taskView;

const entries: PaletteEntry[] = [
  { kind: "action", item: action },
  { kind: "task", item: task },
];
const main: CommandPaletteMainList = {
  groups: [],
  entries,
  enabledValues: [action.key, task.key],
  taskByKey: new Map([[task.key, task]]),
  chatByKey: new Map(),
};

describe("highlightOf", () => {
  test("keeps a highlight that is still in the list and scrolls only to one that the palette set", () => {
    const fromList = highlightOf({
      highlighted: { value: task.key, fromList: true },
      rowList: null,
      main,
      taskViewOf,
    });
    const fromPalette = highlightOf({
      highlighted: { value: task.key, fromList: false },
      rowList: null,
      main,
      taskViewOf,
    });

    expect(fromList).toMatchObject({ value: task.key, needsScroll: false, taskView });
    expect(fromPalette.needsScroll).toBe(true);
  });

  test("moves to the first enabled row when the highlighted row leaves the list", () => {
    for (const highlighted of [null, { value: "task:w:gone", fromList: true }]) {
      expect(highlightOf({ highlighted, rowList: null, main, taskViewOf })).toMatchObject({
        value: action.key,
        needsScroll: true,
        taskView: null,
      });
    }
  });

  test("highlights only enabled actions of an open row action list", () => {
    const rowList: PaletteRowList = {
      entry: { kind: "task", item: task },
      note: null,
      actions: [rowAction("copy-id", true), rowAction("edit")],
    };

    expect(highlightOf({ highlighted: null, rowList, main, taskViewOf })).toMatchObject({
      value: "edit",
      enabledValues: ["edit"],
      entry: undefined,
      taskView: null,
    });
  });
});
