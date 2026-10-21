import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type BrowserTabSummary,
  type RepoAction,
  type TerminalSummary,
} from "@openducktor/contracts";
import { act, fireEvent, renderHook } from "@testing-library/react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { TerminalSessionsModel, TerminalTab } from "@/features/terminals";
import { inAppLinkTarget } from "@/lib/link-open";
import { withMockedToast } from "@/test-utils/mock-toast";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
  createSessionPanelBrowserFixture,
  createTerminalSessionsFixture,
} from "@/test-utils/session-panel-fixtures";
import type { PanelId, ToolTabKind } from "./panel-tab-kinds";
import {
  appendRightPanelEntry,
  type BrowserTabEntry,
  browserTabEntry,
  findPanelTab,
  type PanelTabEntry,
  type SessionPanelOwner,
  type SessionPanelSelectionKey,
  sessionPanelOwnerKey,
} from "./session-panel-layout";
import {
  type SessionPanelLayoutStore,
  sessionPanelLayoutStorageKey,
  useSessionPanelLayoutStore,
} from "./session-panel-layout-store";
import { RIGHT_PANEL_OPEN_STORAGE_KEY } from "./use-right-panel-open";
import { type SessionPanelBrowserModel, useSessionPanels } from "./use-session-panels";
import { SessionViewContext } from "../session-navigation/session-view-context";

const WITHOUT_CI_CHECKS: ReadonlySet<ToolTabKind> = new Set(["ci_checks"]);
const NO_TERMINAL_TABS: TerminalTab[] = [];

type SelectionProps = { selectionKey: SessionPanelSelectionKey };

const newTaskOwner = (): SessionPanelOwner => ({
  kind: "task",
  workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
  taskId: "task-1",
});

// Each test gets its own connection, so it starts with no saved panel layouts.
let connection: ClientConnection;
const wrapper = ({ children }: { children: ReactNode }) => (
  <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
);

beforeEach(() => {
  connection = createTestClientConnection();
});

/** The panel layout store of the test connection. */
const layoutStore = (): SessionPanelLayoutStore =>
  renderHook(() => useSessionPanelLayoutStore(), { wrapper }).result.current;

afterEach(() => {
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
 * start, as `useTerminals` does. `setActive` shows or hides the session view of the controller.
 */
const renderPanels = (
  owner: SessionPanelOwner | null,
  initialOverrides: Partial<TerminalSessionsModel>,
  shortcutsEnabled = true,
) => {
  const scopeKey = owner ? sessionPanelOwnerKey(owner) : null;
  const starts: (RepoAction | undefined)[] = [];
  let isActive = true;
  let latestOverrides = initialOverrides;
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
        shortcutsEnabled,
      });
    },
    {
      initialProps: { overrides: initialOverrides },
      wrapper: ({ children }: { children: ReactNode }) => (
        <ClientConnectionProvider connection={connection}>
          <SessionViewContext value={{ id: "view", isActive }}>{children}</SessionViewContext>
        </ClientConnectionProvider>
      ),
    },
  );
  return {
    ...view,
    starts,
    setTerminals: (overrides: Partial<TerminalSessionsModel>) => {
      latestOverrides = overrides;
      view.rerender({ overrides });
    },
    setActive: (active: boolean) => {
      isActive = active;
      view.rerender({ overrides: latestOverrides });
    },
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
      { initialProps: { owner: first }, wrapper },
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
      { initialProps: { tabs: NO_TERMINAL_TABS }, wrapper },
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
      { initialProps: builder, wrapper },
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

  test("kept session views share the right panel open state", () => {
    const shown = renderPanels(newTaskOwner(), {});
    const kept = renderPanels(newTaskOwner(), {});
    try {
      act(() => shown.result.current.rightToggle?.onToggle());
      expect(kept.result.current.rightToggle?.isOpen).toBe(false);
      act(() => kept.result.current.rightToggle?.onToggle());
      expect(shown.result.current.rightToggle?.isOpen).toBe(true);
    } finally {
      shown.unmount();
      kept.unmount();
    }
  });

  test("a hidden view ends its panel slides and takes shared changes at once", () => {
    const kept = renderPanels(newTaskOwner(), {});
    const shown = renderPanels(newTaskOwner(), {});
    try {
      act(() => kept.result.current.rightToggle?.onToggle());
      expect(kept.result.current.right.presence).toBe("closing");
      act(() => kept.setActive(false));
      expect(kept.result.current.right.presence).toBe("closed");

      // A hidden view has no size and no transition, so a slide in it could not end.
      act(() => shown.result.current.rightToggle?.onToggle());
      expect(shown.result.current.right.presence).toBe("opening");
      expect(kept.result.current.right.presence).toBe("open");
    } finally {
      shown.unmount();
      kept.unmount();
    }
  });

  test("a view that becomes hidden drops its terminal focus requests", () => {
    const view = renderPanels(newTaskOwner(), { tabs: [terminalTab("terminal-1")] });
    const reopenBottom = () => {
      act(() => view.result.current.bottomToggle.onToggle());
      act(() => view.result.current.bottomToggle.onToggle());
    };
    try {
      reopenBottom();
      expect(view.result.current.bottom.focusRequest).toBe(1);

      act(() => view.setActive(false));
      act(() => view.setActive(true));
      expect(view.result.current.bottom.focusRequest).toBe(0);

      reopenBottom();
      expect(view.result.current.bottom.focusRequest).toBe(1);
    } finally {
      view.unmount();
    }
  });

  test.each([true, false])(
    "honors the bottom panel keyboard shortcut when enabled=%s",
    (shortcutsEnabled) => {
      const view = renderPanels(
        newTaskOwner(),
        { tabs: [terminalTab("terminal-1")] },
        shortcutsEnabled,
      );
      expect(view.result.current.bottom.isVisible).toBe(true);

      act(() => {
        fireEvent.keyDown(window, { key: "`", ctrlKey: true });
      });
      expect(view.result.current.bottom.presence).toBe(shortcutsEnabled ? "closed" : "open");
      act(() => {
        fireEvent.keyDown(window, { key: "`", ctrlKey: true });
      });
      expect(view.result.current.bottom.presence).toBe("open");

      act(() => view.result.current.bottomToggle.onToggle());
      expectPanelSlidesOut(view, "bottom");
    },
  );

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
      connection.storage.setItem(sessionPanelLayoutStorageKey(owner), "{not json");

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

const TAB_1 = browserTabIdFixture(1);
const TAB_2 = browserTabIdFixture(2);
const DEFAULT_RIGHT_IDS = ["document", "diffs", "files"];

const savedBrowserEntry = (tabId: string): BrowserTabEntry => ({
  id: `browser:${tabId}`,
  kind: "browser",
  tabId,
});

/** Saves the default tool tabs of a task and the given browser entries before the page shows. */
const saveLayout = (
  owner: SessionPanelOwner,
  right: PanelTabEntry[],
  bottom: PanelTabEntry[] = [],
): void =>
  layoutStore().update(owner, (layout) => ({
    ...layout,
    panels: {
      right: [
        { id: "document", kind: "document" },
        { id: "diffs", kind: "diffs" },
        { id: "files", kind: "files" },
        ...right,
      ],
      bottom,
    },
  }));

type BrowserHarnessProps = { browser: Partial<SessionPanelBrowserModel> };

/** The calls that the panels made to the browser feature, in order. */
type BrowserFeatureCalls = { started: string[]; closed: string[] };

/** Renders the controller with a browser model that records each call to the browser feature. */
const renderBrowserPanels = (
  owner: SessionPanelOwner,
  initialBrowser: Partial<SessionPanelBrowserModel>,
) => {
  const scopeKey = sessionPanelOwnerKey(owner);
  const calls: BrowserFeatureCalls = { started: [], closed: [] };
  const view = renderHook(
    ({ browser }: BrowserHarnessProps) => {
      const terminals = useMemo(() => createTerminalSessionsFixture({ scopeKey }), []);
      // The browser feature owns `openingTabIds` and `closingTabIds`. Each test gives them.
      const model = useMemo(
        () =>
          createSessionPanelBrowserFixture({
            scopeKey,
            startTab: (tabId) => calls.started.push(tabId),
            closeTab: async (tabId) => {
              calls.closed.push(tabId);
            },
            ...browser,
          }),
        [browser],
      );
      return useSessionPanels({
        owner,
        selectionKey: "build",
        unavailableKinds: WITHOUT_CI_CHECKS,
        terminals,
        browser: model,
      });
    },
    { initialProps: { browser: initialBrowser }, wrapper },
  );
  return {
    ...view,
    calls,
    setBrowser: (browser: Partial<SessionPanelBrowserModel>) => view.rerender({ browser }),
  };
};

const hostTab = (tabId: string, overrides: Partial<BrowserTabSummary> = {}): BrowserTabSummary =>
  createBrowserTabSummaryFixture({ tabId, ...overrides });

describe("useSessionPanels browser tabs", () => {
  test("offers a Browser card in both panels with its blocked reason", () => {
    const view = renderBrowserPanels(newTaskOwner(), {
      startBlockedReason: "Close a browser tab to open another one.",
    });

    const browserCard = {
      kind: "browser" as const,
      disabledReason: "Close a browser tab to open another one.",
    };
    expect(view.result.current.right.launcher).toEqual([
      { kind: "terminal", disabledReason: null },
      browserCard,
    ]);
    expect(view.result.current.bottom.launcher).toEqual([
      { kind: "terminal", disabledReason: null },
      browserCard,
    ]);
  });

  test("opens a picked browser tab, asks the browser feature to open it, and focuses its address bar", async () => {
    const opened: string[] = [];
    // Before the host list syncs, the panels keep every entry.
    const view = renderBrowserPanels(newTaskOwner(), {
      isSynced: false,
      openTab: async (tabId) => {
        opened.push(tabId);
      },
    });

    act(() => view.result.current.right.onAddTab());
    act(() => view.result.current.right.onPick("browser"));

    const entry = view.result.current.right.tabs.at(-1);
    if (entry?.kind !== "browser") throw new Error("Expected an opened browser tab.");
    const { tabId } = entry.entry;
    expect(view.result.current.right.tabs.map((tab) => tab.id)).toEqual([
      ...DEFAULT_RIGHT_IDS,
      `browser:${tabId}`,
    ]);
    expect(view.result.current.right.selectedTabId).toBe(`browser:${tabId}`);
    expect(view.result.current.right.browserAddressFocus).toEqual({ tabId, request: 1 });
    expect(view.result.current.right.focusRequest).toBe(0);
    expect(opened).toEqual([tabId]);

    // The new tab keeps its place while it opens and the host list does not have it yet.
    view.setBrowser({ tabs: [], openingTabIds: new Set([tabId]) });
    expect(view.result.current.right.selectedTabId).toBe(`browser:${tabId}`);
    // Once the tab is open, the host list decides: a closed tab leaves.
    view.setBrowser({ tabs: [] });
    expect(view.result.current.right.tabs.map((tab) => tab.id)).toEqual(DEFAULT_RIGHT_IDS);
  });

  test("asks once to start each saved tab, and drops saved tabs that the host does not have", () => {
    const owner = newTaskOwner();
    saveLayout(owner, [savedBrowserEntry(TAB_1), savedBrowserEntry(TAB_2)]);
    const view = renderBrowserPanels(owner, { isSynced: false });
    const saved = hostTab(TAB_1, { started: false, live: false });

    view.setBrowser({ tabs: [saved] });
    view.setBrowser({ tabs: [saved] });
    expect(view.calls.started).toEqual([TAB_1]);
    expect(view.result.current.right.tabs.map((tab) => tab.id)).toEqual([
      ...DEFAULT_RIGHT_IDS,
      `browser:${TAB_1}`,
    ]);

    // After a host restart, the tab has not started again, so it starts again.
    view.setBrowser({ tabs: [hostTab(TAB_1)] });
    view.setBrowser({ tabs: [saved] });
    expect(view.calls.started).toEqual([TAB_1, TAB_1]);
  });

  test("hides a closing browser tab, and removes it once the host list no longer has it", async () => {
    const owner = newTaskOwner();
    saveLayout(owner, [savedBrowserEntry(TAB_1), savedBrowserEntry(TAB_2)]);
    const view = renderBrowserPanels(owner, { tabs: [hostTab(TAB_1), hostTab(TAB_2)] });
    act(() => view.result.current.right.onSelect(`browser:${TAB_1}`));

    await act(async () => view.result.current.right.onClose(`browser:${TAB_1}`));

    expect(view.calls.closed).toEqual([TAB_1]);
    expect(view.result.current.right.selectedTabId).toBe(`browser:${TAB_2}`);

    view.setBrowser({ tabs: [hostTab(TAB_1), hostTab(TAB_2)], closingTabIds: new Set([TAB_1]) });
    expect(view.result.current.right.tabs.map((tab) => tab.id)).toEqual([
      ...DEFAULT_RIGHT_IDS,
      `browser:${TAB_2}`,
    ]);

    view.setBrowser({ tabs: [hostTab(TAB_2)] });
    expect(findPanelTab(layoutStore().read(owner), `browser:${TAB_1}`)).toBeNull();
  });

  test("shows a browser tab again and reports the error when its close fails", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const owner = newTaskOwner();
      saveLayout(owner, [savedBrowserEntry(TAB_1)]);
      const view = renderBrowserPanels(owner, {
        tabs: [hostTab(TAB_1, { title: "Dashboard" })],
        closeTab: async () => {
          throw new Error("The host is not ready.");
        },
      });
      act(() => view.result.current.right.onSelect(`browser:${TAB_1}`));

      await act(async () => view.result.current.right.onClose(`browser:${TAB_1}`));

      expect(view.result.current.right.tabs.map((tab) => tab.id)).toContain(`browser:${TAB_1}`);
      expect(view.result.current.right.selectedTabId).toBe(`browser:${TAB_1}`);
      expect(toastErrorMock).toHaveBeenCalledWith("Could not close Dashboard", {
        description: "The host is not ready.",
      });
    });
  });

  test("opens a link of the page in a new tab at the end of the right panel and shows the panel", async () => {
    localStorage.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, "false");
    const addresses: Array<string | null> = [];
    let listed: () => void = () => {};
    // Before the host list syncs, the panels keep every entry.
    const view = renderBrowserPanels(newTaskOwner(), {
      isSynced: false,
      // The open resolves when the host list has the tab.
      openTab: (_tabId, address) => {
        addresses.push(address);
        return new Promise<void>((resolve) => {
          listed = resolve;
        });
      },
    });
    const target = inAppLinkTarget();
    if (target === null) throw new Error("Expected the page to open links in browser tabs.");

    let opened: Promise<void> = Promise.resolve();
    act(() => {
      opened = target.open("http://localhost:3000/docs");
    });

    const entry = view.result.current.right.tabs.at(-1);
    if (entry?.kind !== "browser") throw new Error("Expected a new browser tab.");
    expect(addresses).toEqual(["http://localhost:3000/docs"]);
    expect(view.result.current.right.selectedTabId).toBe(entry.id);
    expect(view.result.current.rightToggle?.isOpen).toBe(true);
    expect(view.result.current.right.browserAddressFocus).toBeNull();
    await act(async () => {
      listed();
      await opened;
    });
    view.unmount();
    expect(inAppLinkTarget()).toBeNull();
  });

  test("gives links the reason why the page cannot open a browser tab", () => {
    const view = renderBrowserPanels(newTaskOwner(), {
      startBlockedReason: "Close a browser tab to open another one.",
    });

    expect(inAppLinkTarget()?.blockedReason).toBe("Close a browser tab to open another one.");
    view.unmount();
  });

  test("shows a hidden right panel without a focus change when an agent opens a tab", () => {
    localStorage.setItem(RIGHT_PANEL_OPEN_STORAGE_KEY, "false");
    const owner = newTaskOwner();
    const view = renderBrowserPanels(owner, {});
    const userTab = hostTab(TAB_1);

    view.setBrowser({ tabs: [userTab] });
    expect(view.result.current.right.isVisible).toBe(false);
    expect(view.result.current.right.tabs.map((tab) => tab.id)).toContain(`browser:${TAB_1}`);

    // As with the browser tab coordinator, the new tab enters the layout before the page renders.
    const agentTab = hostTab(TAB_2, {
      createdBy: "agent",
      owner: { kind: "task", workspaceId: owner.workspaceId, taskId: "task-1" },
    });
    const store = layoutStore();
    act(() => {
      store.update(owner, (layout) =>
        appendRightPanelEntry(layout, "task", browserTabEntry(TAB_2)),
      );
      view.setBrowser({ tabs: [userTab, agentTab] });
    });

    expect(view.result.current.rightToggle?.isOpen).toBe(true);
    expect(view.result.current.right.presence).toBe("opening");
    expect(view.result.current.right.selectedTabId).toBe(`browser:${TAB_2}`);
    expect(view.result.current.right.focusRequest).toBe(0);
    expect(view.result.current.right.browserAddressFocus).toBeNull();
  });

  test("shows the bottom panel on load when it holds a saved browser tab", () => {
    const owner = newTaskOwner();
    saveLayout(owner, [], [savedBrowserEntry(TAB_1)]);

    const view = renderBrowserPanels(owner, { isSynced: false });

    expect(view.result.current.bottom.isVisible).toBe(true);
    expect(view.result.current.bottom.tabs.map((tab) => tab.id)).toEqual([`browser:${TAB_1}`]);
  });

  test("hides saved browser tabs and offers no Browser card on a page without browser tabs", () => {
    const owner = newTaskOwner();
    saveLayout(owner, [savedBrowserEntry(TAB_1)]);

    const view = renderPanels(owner, {});

    expect(view.result.current.right.tabs.map((tab) => tab.id)).toEqual(DEFAULT_RIGHT_IDS);
    expect(view.result.current.right.launcher.map((entry) => entry.kind)).toEqual(["terminal"]);
    expect(findPanelTab(layoutStore().read(owner), `browser:${TAB_1}`)).not.toBeNull();
  });
});
