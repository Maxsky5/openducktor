import { describe, expect, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import type { TerminalTab } from "@/features/terminals";
import {
  addNewPanelTab,
  appendTerminalPanelTab,
  closePanelTab,
  canMovePanelTab,
  emptySessionPanelLayout,
  findTerminalEntry,
  movePanelTab,
  pickPanelTabKind,
  reconcileSessionPanelLayout,
  type SessionPanelContext,
  type SessionPanelLayout,
  selectedPanelTabId,
  selectPanelTab,
  shownPanelTabs,
} from "./session-panel-layout";

const context = (overrides: Partial<SessionPanelContext> = {}): SessionPanelContext => ({
  ownerKind: "task",
  selectionKey: "build",
  unavailableKinds: new Set(["ci_checks"]),
  terminalTabs: [],
  closingTabIds: new Set(),
  terminalTabsSynced: true,
  ...overrides,
});

const readyTab = (terminalId: string, tabId = `tab:${terminalId}`): TerminalTab => {
  const summary: TerminalSummary = {
    terminalId,
    label: terminalId,
    context: { repoPath: "/repo", taskId: "task-1" },
    initialWorkingDir: "/repo",
    createdAt: "2026-10-09T00:00:00.000Z",
    lifecycle: "running",
    exit: null,
    startedBy: "user",
  };
  return {
    tabId,
    terminalId,
    summary,
    awaitingLifecycleSync: false,
    error: null,
    requestState: "ready",
  };
};

const ids = (layout: SessionPanelLayout, panel: "right" | "bottom", ctx: SessionPanelContext) =>
  shownPanelTabs(layout, panel, ctx).map((tab) => tab.id);

const reconciled = (ctx: SessionPanelContext, layout = emptySessionPanelLayout()) =>
  reconcileSessionPanelLayout(layout, ctx);

describe("session panel layout", () => {
  test("opens the default tool tabs of a task and of a chat in the right panel", () => {
    const task = context();
    const chat = context({
      ownerKind: "chat",
      selectionKey: "chat",
    });

    expect(ids(reconciled(task), "right", task)).toEqual(["document", "diffs", "files"]);
    expect(ids(reconciled(task), "bottom", task)).toEqual([]);
    expect(ids(reconciled(chat), "right", chat)).toEqual(["diffs", "files"]);
  });

  test("returns the same layout when nothing changes", () => {
    const ctx = context();
    const layout = reconciled(ctx);

    expect(reconcileSessionPanelLayout(layout, ctx)).toBe(layout);
  });

  test("selects Document for Spec, Planner, and QA, and Diffs for Builder and chats", () => {
    const layout = reconciled(context());

    for (const role of ["spec", "planner", "qa"] as const) {
      expect(selectedPanelTabId(layout, "right", context({ selectionKey: role }))).toBe("document");
    }
    expect(selectedPanelTabId(layout, "right", context({ selectionKey: "build" }))).toBe("diffs");
  });

  test("keeps the same layout when the user selects the selected tab", () => {
    const ctx = context();
    const layout = selectPanelTab(reconciled(ctx), ctx, "right", "files");

    expect(selectPanelTab(layout, ctx, "right", "files")).toBe(layout);
  });

  test("remembers the right panel selection of each role and falls back to the first tab", () => {
    const planner = context({ selectionKey: "planner" });
    let layout = selectPanelTab(reconciled(planner), planner, "right", "files");

    expect(selectedPanelTabId(layout, "right", planner)).toBe("files");
    expect(selectedPanelTabId(layout, "right", context({ selectionKey: "spec" }))).toBe("document");

    layout = closePanelTab(layout, context({ selectionKey: "spec" }), "right", "files");
    expect(selectedPanelTabId(layout, "right", planner)).toBe("document");
  });

  test("closing the selected tab selects its right neighbor, else its left neighbor", () => {
    const ctx = context();
    let layout = selectPanelTab(reconciled(ctx), ctx, "right", "diffs");

    layout = closePanelTab(layout, ctx, "right", "diffs");
    expect(selectedPanelTabId(layout, "right", ctx)).toBe("files");

    layout = closePanelTab(layout, ctx, "right", "files");
    expect(selectedPanelTabId(layout, "right", ctx)).toBe("document");
    expect(layout.closedKinds).toEqual(["diffs", "files"]);
  });

  test("keeps a closed default tab closed until the user opens it from the launcher", () => {
    const ctx = context();
    const closed = closePanelTab(reconciled(ctx), ctx, "right", "files");

    expect(ids(reconcileSessionPanelLayout(closed, ctx), "right", ctx)).toEqual([
      "document",
      "diffs",
    ]);

    const reopened = pickPanelTabKind(closed, ctx, "right", { kind: "files" });
    expect(ids(reopened, "right", ctx)).toEqual(["document", "diffs", "files"]);
    expect(reopened.closedKinds).toEqual([]);
    expect(selectedPanelTabId(reopened, "right", ctx)).toBe("files");
  });

  test("opens CI Checks when it becomes available and gives it back its last position", () => {
    const withCi = context({ unavailableKinds: new Set() });
    const withoutCi = context();
    const initial = reconciled(withoutCi);

    let layout = reconcileSessionPanelLayout(initial, withCi);
    expect(ids(layout, "right", withCi)).toEqual(["document", "diffs", "files", "ci_checks"]);

    layout = movePanelTab(layout, withCi, "ci_checks", "right", {
      id: "document",
      position: "after",
    });
    expect(ids(layout, "right", withCi)).toEqual(["document", "ci_checks", "diffs", "files"]);

    layout = reconcileSessionPanelLayout(layout, withoutCi);
    expect(ids(layout, "right", withoutCi)).toEqual(["document", "diffs", "files"]);

    layout = reconcileSessionPanelLayout(layout, withCi);
    expect(ids(layout, "right", withCi)).toEqual(["document", "ci_checks", "diffs", "files"]);

    layout = closePanelTab(layout, withCi, "right", "ci_checks");
    expect(ids(reconcileSessionPanelLayout(layout, withCi), "right", withCi)).not.toContain(
      "ci_checks",
    );
  });

  test("keeps one New tab per panel and replaces it with the picked kind", () => {
    const ctx = context();
    const start = closePanelTab(reconciled(ctx), ctx, "right", "diffs");
    let layout = addNewPanelTab(start, ctx, "right");
    layout = selectPanelTab(layout, ctx, "right", "document");
    layout = addNewPanelTab(layout, ctx, "right");

    expect(ids(layout, "right", ctx)).toEqual(["document", "files", "new_tab:right"]);
    expect(selectedPanelTabId(layout, "right", ctx)).toBe("new_tab:right");

    layout = movePanelTab(layout, ctx, "new_tab:right", "right", {
      id: "files",
      position: "before",
    });
    layout = pickPanelTabKind(layout, ctx, "right", { kind: "diffs" });

    expect(ids(layout, "right", ctx)).toEqual(["document", "diffs", "files"]);
    expect(selectedPanelTabId(layout, "right", ctx)).toBe("diffs");
  });

  test("picking a unique kind that is open closes the New tab and selects the open tab", () => {
    const ctx = context();
    let layout = addNewPanelTab(reconciled(ctx), ctx, "right");

    layout = pickPanelTabKind(layout, ctx, "right", { kind: "files" });

    expect(ids(layout, "right", ctx)).toEqual(["document", "diffs", "files"]);
    expect(selectedPanelTabId(layout, "right", ctx)).toBe("files");
  });

  test("puts a picked terminal in place of the New tab and binds it to its terminal", () => {
    const creating: TerminalTab = {
      tabId: "creating:1",
      terminalId: null,
      summary: null,
      label: "/repo",
      actionId: null,
      error: null,
      requestState: "creating",
    };
    const ctx = context({ terminalTabs: [creating] });
    let layout = addNewPanelTab(reconciled(ctx), ctx, "right");

    layout = pickPanelTabKind(layout, ctx, "right", { kind: "terminal", tabId: "creating:1" });
    expect(ids(layout, "right", ctx)).toEqual([
      "document",
      "diffs",
      "files",
      "terminal:creating:1",
    ]);

    const created = readyTab("terminal-1", "creating:1");
    layout = reconcileSessionPanelLayout(layout, context({ terminalTabs: [created] }));
    // A later page mount finds the terminal with a new tab ID and keeps its position.
    const rediscovered = context({ terminalTabs: [readyTab("terminal-1")] });
    layout = reconcileSessionPanelLayout(layout, rediscovered);

    expect(ids(layout, "right", rediscovered)).toEqual([
      "document",
      "diffs",
      "files",
      "terminal:creating:1",
    ]);
    expect(findTerminalEntry(layout, readyTab("terminal-1"))).toEqual({
      panel: "right",
      entry: {
        id: "terminal:creating:1",
        kind: "terminal",
        tabId: "tab:terminal-1",
        terminalId: "terminal-1",
      },
    });
  });

  test("opens terminals without a position in the bottom panel once the host list is known", () => {
    const tabs = [readyTab("terminal-1"), readyTab("terminal-2")];
    const unsynced = context({ terminalTabs: tabs, terminalTabsSynced: false });
    const synced = context({ terminalTabs: tabs });

    expect(ids(reconciled(unsynced), "bottom", unsynced)).toEqual([]);
    expect(ids(reconciled(synced), "bottom", synced)).toEqual([
      "terminal:tab:terminal-1",
      "terminal:tab:terminal-2",
    ]);
  });

  test("keeps terminal entries until the host list proves that their terminal ended", () => {
    const tab = readyTab("terminal-1");
    const layout = reconciled(context({ terminalTabs: [tab] }));

    const waiting = reconcileSessionPanelLayout(
      layout,
      context({ terminalTabs: [], terminalTabsSynced: false }),
    );
    expect(waiting).toBe(layout);

    const ended = reconcileSessionPanelLayout(layout, context({ terminalTabs: [] }));
    expect(ended.panels.bottom).toEqual([]);
  });

  test("hides a closing terminal but keeps its position", () => {
    const tabs = [readyTab("terminal-1"), readyTab("terminal-2")];
    const layout = reconciled(context({ terminalTabs: tabs }));
    const closing = context({ terminalTabs: tabs, closingTabIds: new Set(["tab:terminal-1"]) });

    expect(ids(layout, "bottom", closing)).toEqual(["terminal:tab:terminal-2"]);
    expect(layout.panels.bottom.map((entry) => entry.id)).toEqual([
      "terminal:tab:terminal-1",
      "terminal:tab:terminal-2",
    ]);
  });

  test("moves a terminal to the other panel and selects it there", () => {
    const tabs = [readyTab("terminal-1"), readyTab("terminal-2")];
    const ctx = context({ terminalTabs: tabs });
    let layout = selectPanelTab(reconciled(ctx), ctx, "bottom", "terminal:tab:terminal-1");

    layout = movePanelTab(layout, ctx, "terminal:tab:terminal-1", "right", {
      id: "diffs",
      position: "before",
    });

    expect(ids(layout, "right", ctx)).toEqual([
      "document",
      "terminal:tab:terminal-1",
      "diffs",
      "files",
    ]);
    expect(selectedPanelTabId(layout, "right", ctx)).toBe("terminal:tab:terminal-1");
    expect(selectedPanelTabId(layout, "bottom", ctx)).toBe("terminal:tab:terminal-2");
  });

  test("never puts a tab in a panel that its kind does not allow", () => {
    const ctx = context();
    const layout = reconciled(ctx);

    expect(movePanelTab(layout, ctx, "diffs", "bottom", null)).toBe(layout);
    expect(appendTerminalPanelTab(layout, ctx, "right", "creating:1").panels.right).toHaveLength(4);
    const withNewTab = addNewPanelTab(layout, ctx, "bottom");
    expect(pickPanelTabKind(withNewTab, ctx, "bottom", { kind: "files" })).toEqual({
      ...withNewTab,
      panels: { ...withNewTab.panels, bottom: [] },
      selectedRight: { build: "files" },
    });
  });

  test("drops kinds that the owner cannot use", () => {
    const chat = context({
      ownerKind: "chat",
      selectionKey: "chat",
    });
    const fromTask: SessionPanelLayout = {
      panels: {
        right: [
          { id: "document", kind: "document" },
          { id: "files", kind: "files" },
          { id: "diffs", kind: "diffs" },
        ],
        bottom: [],
      },
      closedKinds: [],
      selectedRight: { chat: "document" },
      selectedBottom: null,
    };

    const layout = reconcileSessionPanelLayout(fromTask, chat);

    expect(ids(layout, "right", chat)).toEqual(["files", "diffs"]);
    // The remembered Document tab is gone, so the panel selects its first tab.
    expect(selectedPanelTabId(layout, "right", chat)).toBe("files");
  });

  test("selects the first tab when the remembered tab ended with the app", () => {
    // A saved layout keeps a selected terminal as a selection whose tab is gone.
    const restored: SessionPanelLayout = {
      ...emptySessionPanelLayout(),
      panels: {
        right: [
          { id: "diffs", kind: "diffs" },
          { id: "files", kind: "files" },
        ],
        bottom: [],
      },
      closedKinds: ["document"],
      selectedRight: { build: null },
    };

    expect(ids(restored, "right", context())).toEqual(["diffs", "files"]);
    expect(selectedPanelTabId(restored, "right", context())).toBe("diffs");
  });

  test("allows a reorder in each panel and a move only to a panel that the kind allows", () => {
    const tabs = [readyTab("terminal-1")];
    const ctx = context({ terminalTabs: tabs });
    const layout = addNewPanelTab(reconciled(ctx), ctx, "right");

    expect(canMovePanelTab(layout, ctx, "diffs", "right")).toBe(true);
    expect(canMovePanelTab(layout, ctx, "diffs", "bottom")).toBe(false);
    expect(canMovePanelTab(layout, ctx, "terminal:tab:terminal-1", "right")).toBe(true);
    expect(canMovePanelTab(layout, ctx, "new_tab:right", "right")).toBe(true);
    expect(canMovePanelTab(layout, ctx, "new_tab:right", "bottom")).toBe(false);
    expect(canMovePanelTab(layout, ctx, "missing", "right")).toBe(false);
  });

  test("selects the first tab, not the role default, when the remembered tab closes", () => {
    const builder = context({ selectionKey: "build" });
    const spec = context({ selectionKey: "spec" });
    let layout = selectPanelTab(reconciled(builder), builder, "right", "files");

    layout = closePanelTab(layout, spec, "right", "files");
    layout = reconcileSessionPanelLayout(layout, builder);

    expect(ids(layout, "right", builder)).toEqual(["document", "diffs"]);
    expect(selectedPanelTabId(layout, "right", builder)).toBe("document");
    // A role without a selection still starts on its default tab.
    expect(selectedPanelTabId(layout, "right", context({ selectionKey: "qa" }))).toBe("document");
  });

  test("selects the first tab when a moved terminal was the remembered tab of another role", () => {
    const tabs = [readyTab("terminal-1")];
    const builder = context({ selectionKey: "build", terminalTabs: tabs });
    const spec = context({ selectionKey: "spec", terminalTabs: tabs });
    let layout = movePanelTab(
      reconciled(builder),
      builder,
      "terminal:tab:terminal-1",
      "right",
      null,
    );

    layout = movePanelTab(layout, spec, "terminal:tab:terminal-1", "bottom", null);
    layout = reconcileSessionPanelLayout(layout, builder);

    expect(selectedPanelTabId(layout, "right", builder)).toBe("document");
  });
});
