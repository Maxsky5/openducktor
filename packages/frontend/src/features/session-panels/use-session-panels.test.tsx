import { afterEach, describe, expect, test } from "bun:test";
import type { RepoAction, TerminalSummary } from "@openducktor/contracts";
import { act, fireEvent, renderHook } from "@testing-library/react";
import { useCallback, useMemo, useState } from "react";
import type { TerminalSessionsModel, TerminalTab } from "@/features/terminals";
import { withMockedToast } from "@/test-utils/mock-toast";
import { createTerminalSessionsFixture } from "@/test-utils/session-panel-fixtures";
import type { PanelId, ToolTabKind } from "./panel-tab-kinds";
import {
  type SessionPanelOwner,
  type SessionPanelSelectionKey,
  sessionPanelOwnerKey,
} from "./session-panel-layout";
import {
  pruneSessionPanelLayouts,
  sessionPanelLayoutStorageKey,
} from "./session-panel-layout-store";
import { RIGHT_PANEL_OPEN_STORAGE_KEY } from "./use-right-panel-open";
import { useSessionPanels } from "./use-session-panels";

const WITHOUT_CI_CHECKS: ReadonlySet<ToolTabKind> = new Set(["ci_checks"]);
const workspaceIds = new Set<string>();
const NO_TERMINAL_TABS: TerminalTab[] = [];

type SelectionProps = { selectionKey: SessionPanelSelectionKey };

const newTaskOwner = (): SessionPanelOwner => {
  const workspaceId = `workspace-${globalThis.crypto.randomUUID()}`;
  workspaceIds.add(workspaceId);
  return { kind: "task", workspaceId, taskId: "task-1" };
};

afterEach(() => {
  // The hook of the test is still mounted, so the store update runs in act.
  act(() => {
    for (const workspaceId of workspaceIds) {
      pruneSessionPanelLayouts({ kind: "tasks", workspaceId, ids: new Set() });
      pruneSessionPanelLayouts({ kind: "chats", workspaceId, ids: new Set() });
    }
  });
  workspaceIds.clear();
  localStorage.removeItem(RIGHT_PANEL_OPEN_STORAGE_KEY);
});

const terminalTab = (terminalId: string, startedBy: TerminalSummary["startedBy"] = "user") => {
  const summary: TerminalSummary = {
    terminalId,
    label: `Shell ${terminalId}`,
    context: { repoPath: "/repo", taskId: "task-1" },
    initialWorkingDir: "/repo",
    createdAt: "2026-10-09T00:00:00.000Z",
    lifecycle: "running",
    exit: null,
    startedBy,
  };
  const tab: TerminalTab = {
    tabId: `tab:${terminalId}`,
    terminalId,
    summary,
    awaitingLifecycleSync: false,
    error: null,
    requestState: "ready",
  };
  return tab;
};

type HarnessProps = { overrides: Partial<TerminalSessionsModel> };

/**
 * Renders the controller with a terminal model that adds a creating tab in the same update as the
 * start, as `useTerminals` does.
 */
const renderPanels = (
  owner: SessionPanelOwner | null,
  initialOverrides: Partial<TerminalSessionsModel>,
) => {
  const scopeKey = owner ? sessionPanelOwnerKey(owner) : null;
  const starts: (RepoAction | undefined)[] = [];
  const view = renderHook(
    ({ overrides }: HarnessProps) => {
      const [startedTabs, setStartedTabs] = useState<TerminalTab[]>([]);
      const createTerminal = useCallback((action?: RepoAction): string | null => {
        starts.push(action);
        const tabId = `creating:${starts.length}`;
        setStartedTabs((tabs) => [...tabs, creatingTab(tabId)]);
        return tabId;
      }, []);
      const terminals = useMemo(
        () =>
          createTerminalSessionsFixture({
            scopeKey,
            isAvailable: owner !== null,
            createTerminal,
            ...overrides,
            tabs: [...(overrides.tabs ?? []), ...startedTabs],
          }),
        [createTerminal, overrides, startedTabs],
      );
      return useSessionPanels({
        owner,
        selectionKey: "build",
        unavailableKinds: WITHOUT_CI_CHECKS,
        terminals,
      });
    },
    { initialProps: { overrides: initialOverrides } },
  );
  return {
    ...view,
    starts,
    setTerminals: (overrides: Partial<TerminalSessionsModel>) => view.rerender({ overrides }),
  };
};

const creatingTab = (tabId: string): TerminalTab => ({
  tabId,
  terminalId: null,
  summary: null,
  label: "/repo",
  actionId: null,
  error: null,
  requestState: "creating",
});

/** Ends the close transition of a panel, as the panel split does on the page. */
const expectPanelSlidesOut = (view: ReturnType<typeof renderPanels>, panel: PanelId): void => {
  expect(view.result.current[panel].isVisible).toBe(true);
  expect(view.result.current[panel].presence).toBe("closing");
  act(() => view.result.current[panel].onSettled());
  expect(view.result.current[panel].presence).toBe("closed");
  expect(view.result.current[panel].isVisible).toBe(false);
};

const entryIdOf = (tabs: { id: string; kind: string }[], kind: string): string => {
  const tab = tabs.find((entry) => entry.kind === kind);
  if (!tab) throw new Error(`Expected a ${kind} tab.`);
  return tab.id;
};

describe("useSessionPanels", () => {
  test("offers no right panel toggle and no bottom panel without a task or chat", () => {
    const view = renderPanels(null, {});

    expect(view.result.current.rightToggle).toBeNull();
    expect(view.result.current.bottomToggle.isAvailable).toBe(false);
    expect(view.result.current.right.isVisible).toBe(false);
    expect(view.result.current.right.tabs).toEqual([]);
  });

  test("lists the kinds that each panel can open now and why a terminal cannot start", () => {
    const view = renderPanels(newTaskOwner(), {
      startBlockedReason: "Terminals are loading.",
    });

    // The open unique tabs have no entry.
    expect(view.result.current.right.launcher).toEqual([
      { kind: "terminal", disabledReason: "Terminals are loading." },
    ]);
    act(() => view.result.current.right.onClose("diffs"));
    expect(view.result.current.right.launcher).toEqual([
      { kind: "diffs", disabledReason: null },
      { kind: "terminal", disabledReason: "Terminals are loading." },
    ]);
    expect(view.result.current.bottom.launcher).toEqual([
      { kind: "terminal", disabledReason: "Terminals are loading." },
    ]);
  });

  test("starts a terminal in place of the right panel New tab and focuses it", () => {
    const view = renderPanels(newTaskOwner(), {});

    act(() => view.result.current.right.onAddTab());
    expect(view.result.current.right.selectedTabId).toBe("new_tab:right");

    act(() => view.result.current.right.onPick("terminal"));

    expect(view.starts).toEqual([undefined]);
    expect(view.result.current.right.tabs.map((tab) => tab.kind)).toEqual([
      "document",
      "diffs",
      "files",
      "terminal",
    ]);
    expect(view.result.current.right.selectedTabId).toBe("terminal:creating:1");
    expect(view.result.current.right.focusRequest).toBe(1);
    expect(view.result.current.right.activeTerminalKey).toContain("creating:1");
  });

  test("moves a terminal to the right panel and hides the emptied bottom panel", () => {
    const owner = newTaskOwner();
    const tab = terminalTab("terminal-1");
    const view = renderPanels(owner, {
      tabs: [tab],
      mountedTabs: [{ scopeKey: sessionPanelOwnerKey(owner), tab }],
    });
    expect(view.result.current.bottom.isVisible).toBe(true);
    const entryId = entryIdOf(view.result.current.bottom.tabs, "terminal");
    expect(view.result.current.bottom.terminalMounts.map((mount) => mount.tab.tabId)).toEqual([
      "tab:terminal-1",
    ]);

    expect(view.result.current.canMove(entryId, "right")).toBe(true);
    expect(view.result.current.canMove("diffs", "bottom")).toBe(false);
    act(() => view.result.current.onMove(entryId, "right"));

    expectPanelSlidesOut(view, "bottom");
    expect(view.result.current.bottom.tabs).toEqual([]);
    expect(view.result.current.right.selectedTabId).toBe(entryId);
    expect(view.result.current.right.focusRequest).toBe(1);
    expect(view.result.current.right.terminalMounts.map((mount) => mount.tab.tabId)).toEqual([
      "tab:terminal-1",
    ]);
    expect(view.result.current.bottom.terminalMounts).toEqual([]);
  });

  test("keeps the right panel terminals of another owner mounted but hidden", () => {
    const first = newTaskOwner();
    const second: SessionPanelOwner = {
      kind: "task",
      workspaceId: first.workspaceId,
      taskId: "task-2",
    };
    const tab = terminalTab("terminal-1");
    const mountedTabs = [{ scopeKey: sessionPanelOwnerKey(first), tab }];
    const terminalsFor = (owner: SessionPanelOwner) =>
      createTerminalSessionsFixture({
        scopeKey: sessionPanelOwnerKey(owner),
        tabs: owner === first ? [tab] : [],
        mountedTabs,
      });
    const view = renderHook(
      ({ owner }: { owner: SessionPanelOwner }) =>
        useSessionPanels({
          owner,
          selectionKey: "build",
          unavailableKinds: WITHOUT_CI_CHECKS,
          terminals: terminalsFor(owner),
        }),
      { initialProps: { owner: first } },
    );
    const entryId = entryIdOf(view.result.current.bottom.tabs, "terminal");
    act(() => view.result.current.onMove(entryId, "right"));

    view.rerender({ owner: second });

    expect(view.result.current.right.tabs.map((entry) => entry.kind)).toEqual([
      "document",
      "diffs",
      "files",
    ]);
    expect(view.result.current.right.terminalMounts).toEqual([
      expect.objectContaining({
        key: `${sessionPanelOwnerKey(first)}:tab:terminal-1`,
        value: null,
      }),
    ]);
    expect(view.result.current.right.activeTerminalKey).toBeNull();
    expect(view.result.current.bottom.terminalMounts).toEqual([]);
  });

  test("offers the move of a terminal in the render that first shows it", () => {
    const owner = newTaskOwner();
    const tab = terminalTab("terminal-1");
    const answers: boolean[] = [];
    const view = renderHook(
      ({ tabs }: { tabs: TerminalTab[] }) => {
        const panels = useSessionPanels({
          owner,
          selectionKey: "build",
          unavailableKinds: WITHOUT_CI_CHECKS,
          terminals: createTerminalSessionsFixture({ scopeKey: sessionPanelOwnerKey(owner), tabs }),
        });
        // The tab strip asks this while it renders the new tab.
        const shownTerminal = panels.bottom.tabs.find((entry) => entry.kind === "terminal");
        if (shownTerminal) answers.push(panels.canMove(shownTerminal.id, "right"));
      },
      { initialProps: { tabs: NO_TERMINAL_TABS } },
    );

    view.rerender({ tabs: [tab] });

    expect(answers[0]).toBe(true);
  });

  test("selects the first tab when another role closes the remembered tab", () => {
    const owner = newTaskOwner();
    const terminals = createTerminalSessionsFixture({ scopeKey: sessionPanelOwnerKey(owner) });
    const builder: SelectionProps = { selectionKey: "build" };
    const view = renderHook(
      ({ selectionKey }: SelectionProps) =>
        useSessionPanels({ owner, selectionKey, unavailableKinds: WITHOUT_CI_CHECKS, terminals }),
      { initialProps: builder },
    );
    act(() => view.result.current.right.onSelect("files"));

    view.rerender({ selectionKey: "spec" });
    act(() => view.result.current.right.onClose("files"));
    view.rerender({ selectionKey: "build" });

    expect(view.result.current.right.tabs.map((tab) => tab.id)).toEqual(["document", "diffs"]);
    expect(view.result.current.right.selectedTabId).toBe("document");
  });

  test("shows a hidden right panel when a terminal moves into it", () => {
    localStorage.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, "false");
    const tab = terminalTab("terminal-1");
    const view = renderPanels(newTaskOwner(), { tabs: [tab] });
    expect(view.result.current.right.isVisible).toBe(false);

    act(() =>
      view.result.current.onDrop(entryIdOf(view.result.current.bottom.tabs, "terminal"), "right", {
        id: "diffs",
        position: "after",
      }),
    );

    expect(view.result.current.right.isVisible).toBe(true);
    expect(view.result.current.right.tabs.map((entry) => entry.kind)).toEqual([
      "document",
      "diffs",
      "terminal",
      "files",
    ]);
  });

  test("keeps a host-started terminal in a closed bottom panel until the user opens it", () => {
    const view = renderPanels(newTaskOwner(), { tabs: [terminalTab("setup", "host")] });

    expect(view.result.current.bottom.tabs).toHaveLength(1);
    expect(view.result.current.bottom.isVisible).toBe(false);

    act(() => view.result.current.bottomToggle.onToggle());

    expect(view.result.current.bottom.isVisible).toBe(true);
    expect(view.result.current.bottom.focusRequest).toBe(1);
  });

  test("runs a repository action at the end of the bottom panel and shows the panel", () => {
    const existing = terminalTab("terminal-1", "host");
    const view = renderPanels(newTaskOwner(), { tabs: [existing] });
    const action: RepoAction = {
      id: "test",
      icon: "test",
      name: "Run tests",
      command: "bun test",
      runOnWorktreeCreate: false,
      waitBeforeAgentStart: false,
    };

    act(() => view.result.current.runAction(action));

    expect(view.starts).toEqual([action]);
    expect(view.result.current.bottom.isVisible).toBe(true);
    expect(view.result.current.bottom.tabs.map((tab) => tab.id)).toEqual([
      "terminal:tab:terminal-1",
      "terminal:creating:1",
    ]);
    expect(view.result.current.bottom.selectedTabId).toBe("terminal:creating:1");
  });

  test("starts one terminal when the user opens an empty bottom panel", () => {
    const view = renderPanels(newTaskOwner(), { isLoading: true, isSynced: false });

    act(() => {
      fireEvent.keyDown(window, { key: "`", ctrlKey: true });
    });
    expect(view.result.current.bottom.isVisible).toBe(true);
    expect(view.starts).toEqual([]);

    view.setTerminals({});

    expect(view.starts).toEqual([undefined]);
    expect(view.result.current.bottom.selectedTabId).toBe("terminal:creating:1");
    view.setTerminals({ isLoading: true });
    view.setTerminals({});
    expect(view.starts).toHaveLength(1);
  });

  test("starts no terminal when the bottom panel already has a terminal after discovery", () => {
    const owner = newTaskOwner();
    const view = renderPanels(owner, { isLoading: true, isSynced: false });

    act(() => view.result.current.bottomToggle.onToggle());
    view.setTerminals({ tabs: [terminalTab("terminal-1", "host")] });

    expect(view.starts).toEqual([]);
    expect(view.result.current.bottom.isVisible).toBe(true);
    expect(view.result.current.bottom.tabs).toHaveLength(1);
  });

  test("hides the bottom panel when the host list no longer has its last terminal", () => {
    const view = renderPanels(newTaskOwner(), { tabs: [terminalTab("terminal-1")] });
    act(() => view.result.current.bottomToggle.onToggle());
    act(() => view.result.current.bottomToggle.onToggle());
    expect(view.result.current.bottom.isVisible).toBe(true);

    view.setTerminals({ tabs: [] });

    expect(view.result.current.bottom.tabs).toEqual([]);
    expectPanelSlidesOut(view, "bottom");
  });

  test("keeps an empty bottom panel open while discovery is pending", () => {
    const view = renderPanels(newTaskOwner(), { isLoading: true, isSynced: false });

    act(() => view.result.current.bottomToggle.onToggle());
    view.setTerminals({ isLoading: true, isSynced: false });

    expect(view.result.current.bottom.tabs).toEqual([]);
    expect(view.result.current.bottom.isVisible).toBe(true);
    expect(view.starts).toEqual([]);
  });

  test("does not start a terminal when the user hides the bottom panel before discovery ends", () => {
    const view = renderPanels(newTaskOwner(), { isLoading: true, isSynced: false });

    act(() => view.result.current.bottomToggle.onToggle());
    act(() => view.result.current.bottomToggle.onToggle());
    view.setTerminals({});

    expectPanelSlidesOut(view, "bottom");
    expect(view.starts).toEqual([]);
  });

  test("slides a panel that the user toggles, also back when the user reopens it during a close", () => {
    const view = renderPanels(newTaskOwner(), {});
    // The first render shows the panel at once.
    expect(view.result.current.right.presence).toBe("open");

    act(() => view.result.current.rightToggle?.onToggle());
    expect(view.result.current.rightToggle?.isOpen).toBe(false);
    expect(view.result.current.right.isVisible).toBe(true);
    expect(view.result.current.right.presence).toBe("closing");

    act(() => view.result.current.rightToggle?.onToggle());
    expect(view.result.current.right.presence).toBe("opening");
    act(() => view.result.current.right.onSettled());
    expect(view.result.current.right.presence).toBe("open");

    act(() => view.result.current.rightToggle?.onToggle());
    expectPanelSlidesOut(view, "right");
  });

  test("toggles the bottom panel at once from the keyboard shortcut", () => {
    const view = renderPanels(newTaskOwner(), { tabs: [terminalTab("terminal-1")] });
    expect(view.result.current.bottom.isVisible).toBe(true);

    act(() => {
      fireEvent.keyDown(window, { key: "`", ctrlKey: true });
    });
    expect(view.result.current.bottom.presence).toBe("closed");
    act(() => {
      fireEvent.keyDown(window, { key: "`", ctrlKey: true });
    });
    expect(view.result.current.bottom.presence).toBe("open");

    act(() => view.result.current.bottomToggle.onToggle());
    expectPanelSlidesOut(view, "bottom");
  });

  test("asks at once before it closes a terminal that runs a command, and changes nothing", () => {
    const closeCalls: boolean[] = [];
    const view = renderPanels(newTaskOwner(), {
      tabs: [terminalTab("terminal-1")],
      runningCommandTerminalIds: new Set(["terminal-1"]),
      onClose: async (_tab, confirmTerminate) => {
        closeCalls.push(confirmTerminate);
        return { closed: true };
      },
    });
    const entryId = entryIdOf(view.result.current.bottom.tabs, "terminal");

    act(() => view.result.current.bottom.onClose(entryId));

    expect(view.result.current.terminalClose.candidate?.terminalId).toBe("terminal-1");
    expect(closeCalls).toEqual([]);
    expect(view.result.current.bottom.tabs.map((tab) => tab.id)).toEqual([entryId]);
    expect(view.result.current.bottom.selectedTabId).toBe(entryId);
    expect(view.result.current.bottom.presence).toBe("open");
  });

  test("hides a panel at once when the user collapses it with its separator", () => {
    const view = renderPanels(newTaskOwner(), { tabs: [terminalTab("terminal-1")] });
    expect(view.result.current.right.presence).toBe("open");
    expect(view.result.current.bottom.presence).toBe("open");

    act(() => view.result.current.right.onCollapsed());
    act(() => view.result.current.bottom.onCollapsed());

    expect(view.result.current.rightToggle?.isOpen).toBe(false);
    expect(view.result.current.right.presence).toBe("closed");
    expect(view.result.current.bottomToggle.isOpen).toBe(false);
    expect(view.result.current.bottom.presence).toBe("closed");

    // One click on the toggle opens the panel again.
    act(() => view.result.current.rightToggle?.onToggle());
    expect(view.result.current.right.presence).toBe("opening");
  });

  test("tells the user once when it cannot restore a saved layout", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const owner = newTaskOwner();
      localStorage.setItem(sessionPanelLayoutStorageKey(owner), "{not json");

      const view = renderPanels(owner, {});
      view.setTerminals({});

      expect(view.result.current.right.tabs.map((tab) => tab.kind)).toEqual([
        "document",
        "diffs",
        "files",
      ]);
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock.mock.calls[0]?.[0]).toBe("Could not restore the saved panel layout");
    });
  });
});
