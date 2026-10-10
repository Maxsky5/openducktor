import { describe, expect, mock, test } from "bun:test";
import type { AppPlatform } from "@openducktor/contracts";
import {
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import {
  handlePaletteKeyDown,
  mainListEnterHint,
  paletteFooterHints,
  paletteKeyBindings,
} from "./command-palette-bindings";
import type { PaletteEntry } from "./command-palette-groups";
import type { PaletteTaskView, TaskSessionTarget } from "./command-palette-task-model";
import type { PaletteAction, PaletteChat, PaletteTask } from "./command-palette-types";

const workspace = createWorkspaceRecordFixture();
const task: PaletteTask = {
  key: "task:w:odt-1",
  workspace,
  task: createTaskCardFixture({ id: "odt-1", title: "Polish the palette" }),
};
const builderSession: TaskSessionTarget = {
  role: "build",
  identity: { externalSessionId: "build-1", runtimeKind: "opencode", workingDirectory: "/repo" },
};
const chat: PaletteChat = {
  key: "chat:w:c-1",
  workspace,
  title: "Release notes",
  session: {
    id: "c-1",
    runtimeKind: "codex",
    externalSessionId: "native-c-1",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: "Release notes",
    manualTitle: null,
    createdAt: 0,
    lastActivityAt: 0,
    updatedAt: 0,
    archivedAt: null,
  },
};

const taskView = (overrides: Partial<PaletteTaskView> = {}): PaletteTaskView => ({
  open: { kind: "open_session", session: builderSession },
  sessionsNote: null,
  nextStep: "build_start",
  actions: [],
  sessionOptionsByRole: {},
  ...overrides,
});

const keyEvent = (key: string, modifiers: Partial<Record<ModifierKey, boolean>> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
  preventDefault: mock(() => {}),
});
type ModifierKey = "altKey" | "ctrlKey" | "metaKey" | "shiftKey";

const mainList = ({
  platform = "darwin",
  entry = { kind: "task", item: task },
  view = taskView(),
  caretAtEnd = true,
}: {
  platform?: AppPlatform | null;
  entry?: PaletteEntry;
  view?: PaletteTaskView;
  caretAtEnd?: boolean;
} = {}) => {
  const handlers = {
    back: mock(() => {}),
    runTaskCommand: mock(() => {}),
    renameChat: mock(() => {}),
    showActions: mock(() => {}),
    openScope: mock(() => {}),
  };
  const bindings = paletteKeyBindings({
    platform,
    rowListOpen: false,
    query: "polish",
    entry,
    taskView: entry.kind === "task" ? view : null,
    caretAtEnd: () => caretAtEnd,
    ...handlers,
  });
  return { bindings, ...handlers };
};

const hintLabels = (bindings: ReturnType<typeof mainList>["bindings"]) => {
  const { itemHints, paletteHints } = paletteFooterHints({
    bindings,
    rowListOpen: false,
    back: () => {},
    close: () => {},
  });
  return {
    item: itemHints.map((hint) => hint.label),
    palette: paletteHints.map((hint) => hint.label),
  };
};

describe("command palette key bindings", () => {
  test("runs the next workflow step with Mod+Enter and names it in the footer", () => {
    const { bindings, runTaskCommand } = mainList();
    const event = keyEvent("Enter", { metaKey: true });

    handlePaletteKeyDown(event, bindings);

    expect(runTaskCommand).toHaveBeenCalledWith(
      task,
      { kind: "workflow", action: "build_start" },
      expect.objectContaining({ nextStep: "build_start" }),
    );
    expect(event.preventDefault).toHaveBeenCalled();
    expect(hintLabels(bindings)).toEqual({
      item: ["Start Builder", "Edit", "Actions"],
      palette: ["Workspace", "Close"],
    });
  });

  test("keeps Mod+Enter from cmdk for a task without a next step and hides its hint", () => {
    const { bindings, runTaskCommand } = mainList({ view: taskView({ nextStep: null }) });
    const event = keyEvent("Enter", { metaKey: true });

    handlePaletteKeyDown(event, bindings);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(runTaskCommand).not.toHaveBeenCalled();
    expect(hintLabels(bindings).item).toEqual(["Edit", "Actions"]);
  });

  test("uses Ctrl as the modifier on Linux", () => {
    const { bindings, runTaskCommand } = mainList({ platform: "linux" });

    handlePaletteKeyDown(keyEvent("e", { metaKey: true }), bindings);
    expect(runTaskCommand).not.toHaveBeenCalled();

    handlePaletteKeyDown(keyEvent("e", { ctrlKey: true }), bindings);
    expect(runTaskCommand).toHaveBeenCalledWith(task, { kind: "edit" }, expect.anything());
  });

  test("opens the task actions with Tab, and with Right arrow only at the end of the text", () => {
    const atEnd = mainList();
    handlePaletteKeyDown(keyEvent("Tab"), atEnd.bindings);
    handlePaletteKeyDown(keyEvent("ArrowRight"), atEnd.bindings);
    expect(atEnd.showActions).toHaveBeenCalledTimes(2);

    const inText = mainList({ caretAtEnd: false });
    const arrow = keyEvent("ArrowRight");
    handlePaletteKeyDown(arrow, inText.bindings);
    expect(inText.showActions).not.toHaveBeenCalled();
    expect(arrow.preventDefault).not.toHaveBeenCalled();
  });

  test("opens the scope list with Alt+Down, but not with the platform modifier", () => {
    const { bindings, openScope } = mainList();

    handlePaletteKeyDown(keyEvent("ArrowDown", { altKey: true, metaKey: true }), bindings);
    expect(openScope).not.toHaveBeenCalled();

    handlePaletteKeyDown(keyEvent("ArrowDown", { altKey: true }), bindings);
    expect(openScope).toHaveBeenCalledTimes(1);
  });

  test("has no keys before the platform is known, and Tab never leaves the palette", () => {
    const { bindings, showActions } = mainList({ platform: null });
    const tab = keyEvent("Tab");

    handlePaletteKeyDown(tab, bindings);

    expect(showActions).not.toHaveBeenCalled();
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(hintLabels(bindings)).toEqual({ item: [], palette: ["Close"] });
  });

  test("renames a highlighted chat with Mod+E and opens its actions with Tab", () => {
    const chatEntry: PaletteEntry = { kind: "chat", item: chat };
    const { bindings, renameChat, showActions } = mainList({ entry: chatEntry });

    handlePaletteKeyDown(keyEvent("e", { metaKey: true }), bindings);
    handlePaletteKeyDown(keyEvent("Tab"), bindings);

    expect(renameChat).toHaveBeenCalledWith(chat);
    expect(showActions).toHaveBeenCalledWith(chatEntry);
    expect(hintLabels(bindings).item).toEqual(["Rename", "Actions"]);
  });

  test("returns from a row action list with Backspace only in an empty input", () => {
    const back = mock(() => {});
    const rowList = (query: string) =>
      paletteKeyBindings({
        platform: "darwin",
        rowListOpen: true,
        query,
        back,
        entry: undefined,
        taskView: null,
        runTaskCommand: () => {},
        renameChat: () => {},
        showActions: () => {},
        caretAtEnd: () => true,
        openScope: () => {},
      });

    handlePaletteKeyDown(keyEvent("Backspace"), rowList("edit"));
    expect(back).not.toHaveBeenCalled();
    handlePaletteKeyDown(keyEvent("Backspace"), rowList(""));
    expect(back).toHaveBeenCalledTimes(1);

    const hints = paletteFooterHints({
      bindings: rowList(""),
      rowListOpen: true,
      back,
      close: () => {},
    });
    expect(hints.paletteHints.map((hint) => hint.label)).toEqual(["Back"]);
  });
});

describe("mainListEnterHint", () => {
  const action: PaletteAction = {
    key: "action:settings",
    label: "Open settings",
    workspaceName: null,
    icon: null,
    keywords: [],
    suggested: true,
    disabledReason: null,
    checked: false,
    run: () => {},
  };
  const createFromQuery: PaletteAction = { ...action, key: "action:new-task-from-query" };
  const enterLabel = (
    entry: Parameters<typeof mainListEnterHint>[0]["entry"],
    view: PaletteTaskView | null = null,
    highlightedValue = "",
  ): string | null =>
    mainListEnterHint({
      entry,
      taskView: view,
      createFromQuery,
      highlightedValue,
      openTask: () => {},
      openChat: () => {},
      runAction: () => {},
    })?.label ?? null;

  test("names what Enter does on each row", () => {
    expect(enterLabel({ kind: "task", item: task }, taskView())).toBe("Open Builder session");
    expect(enterLabel({ kind: "task", item: task }, taskView({ open: { kind: "details" } }))).toBe(
      "Open details",
    );
    expect(enterLabel({ kind: "chat", item: chat })).toBe("Open chat");
    expect(enterLabel({ kind: "action", item: action })).toBe("Run");
    expect(enterLabel(undefined, null, createFromQuery.key)).toBe("Run");
  });

  test("offers no Enter while the saved sessions of a task load", () => {
    expect(enterLabel({ kind: "task", item: task }, taskView({ open: null }))).toBeNull();
    expect(enterLabel(undefined)).toBeNull();
  });
});
