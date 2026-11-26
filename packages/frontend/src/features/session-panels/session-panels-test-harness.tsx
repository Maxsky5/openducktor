/**
 * The test harness of the session panels controller: a test connection, render helpers, and saved
 * state helpers. The test files of `useSessionPanels` share it.
 */
import { expect } from "bun:test";
import {
  type BrowserTabSummary,
  type RepoAction,
  type TerminalSummary,
} from "@openducktor/contracts";
import { act, renderHook } from "@testing-library/react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
  createSessionPanelBrowserFixture,
  createTerminalSessionsFixture,
} from "@/test-utils/session-panel-fixtures";
import type { PanelId, ToolTabKind } from "./panel-tab-kinds";
import {
  type BrowserTabEntry,
  type PanelTabEntry,
  type SessionPanelOwner,
  type SessionPanelSelectionKey,
  sessionPanelOwnerKey,
} from "./session-panel-layout";
import {
  type SessionPanelLayoutStore,
  useSessionPanelLayoutStore,
} from "./session-panel-layout-store";
import { savedBottomOpen } from "./session-panel-bottom-rules";
import { type SessionPanelBrowserModel, useSessionPanels } from "./use-session-panels";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";

export const WITHOUT_CI_CHECKS: ReadonlySet<ToolTabKind> = new Set(["ci_checks"]);
export const NO_TERMINAL_TABS: TerminalTab[] = [];

export type SelectionProps = { selectionKey: SessionPanelSelectionKey };

export const newTaskOwner = (): SessionPanelOwner => ({
  kind: "task",
  workspaceId: `workspace-${globalThis.crypto.randomUUID()}`,
  taskId: "task-1",
});

// Each test gets its own connection, so it starts with no saved panel layouts.
let connection: ClientConnection;

/** Starts a new test connection. Each test file calls it before each test. */
export const startTestConnection = (): void => {
  connection = createTestClientConnection();
};

/** The connection of the running test. */
export const testConnection = (): ClientConnection => connection;
export const wrapper = ({ children }: { children: ReactNode }) => (
  <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
);

/** The panel layout store of the test connection. */
export const layoutStore = (): SessionPanelLayoutStore =>
  renderHook(() => useSessionPanelLayoutStore(), { wrapper }).result.current;

/** Saves the open state of a panel of an owner, as an earlier visit did. */
export const saveOpen = (owner: SessionPanelOwner, panel: PanelId, isOpen: boolean): void =>
  panel === "right"
    ? layoutStore().setRightOpen(owner, isOpen)
    : layoutStore().setBottomState(owner, isOpen ? "open" : "closed");

/** Places a terminal in the open bottom panel of an owner, as an earlier view of the same run did. */
export const placeOpenTerminal = (owner: SessionPanelOwner): void => {
  const store = layoutStore();
  store.update(owner, (layout) => ({
    ...layout,
    panels: {
      ...layout.panels,
      bottom: [
        {
          id: "terminal:tab:terminal-1",
          kind: "terminal",
          tabId: "tab:terminal-1",
          terminalId: "terminal-1",
        },
      ],
    },
  }));
  store.setBottomState(owner, "open");
};

/** The bottom panel open state that the record of an owner saves. */
export const savedBottom = (owner: SessionPanelOwner): boolean | null =>
  savedBottomOpen(layoutStore().readPanels(owner).bottom);

/** Starts a new connection on the same device storage, as after a reload or a restart. */
export const reload = (): void => {
  connection = createTestClientConnection({ storage: connection.storage });
};

export const terminalTab = (
  terminalId: string,
  startedBy: TerminalSummary["startedBy"] = "user",
) => {
  const summary: TerminalSummary = {
    terminalId,
    label: `Shell ${terminalId}`,
    context: { workspaceId: "repo", repoPath: "/repo", taskId: "task-1" },
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

/** The values of one rendered controller that stay the same for its whole test. */
type TerminalHarness = {
  owner: SessionPanelOwner | null;
  scopeKey: string | null;
  starts: (RepoAction | undefined)[];
};

type HarnessProps = { overrides: Partial<TerminalSessionsModel>; harness: TerminalHarness };

/**
 * Renders the controller with a terminal model that adds a creating tab in the same update as the
 * start, as `useTerminals` does. `setActive` shows or hides the session view of the controller.
 */
export const renderPanels = (
  owner: SessionPanelOwner | null,
  initialOverrides: Partial<TerminalSessionsModel>,
) => {
  const harness: TerminalHarness = {
    owner,
    scopeKey: owner ? sessionPanelOwnerKey(owner) : null,
    starts: [],
  };
  let isActive = true;
  let latestOverrides = initialOverrides;
  const view = renderHook(
    ({ overrides, harness: current }: HarnessProps) => {
      const [startedTabs, setStartedTabs] = useState<TerminalTab[]>([]);
      const createTerminal = useCallback(
        (action?: RepoAction): string | null => {
          current.starts.push(action);
          const tabId = `creating:${current.starts.length}`;
          setStartedTabs((tabs) => [...tabs, creatingTab(tabId)]);
          return tabId;
        },
        [current],
      );
      const terminals = useMemo(
        () =>
          createTerminalSessionsFixture({
            scopeKey: current.scopeKey,
            isAvailable: current.owner !== null,
            createTerminal,
            ...overrides,
            tabs: [...(overrides.tabs ?? []), ...startedTabs],
          }),
        [createTerminal, current, overrides, startedTabs],
      );
      return useSessionPanels({
        owner: current.owner,
        selectionKey: "build",
        unavailableKinds: WITHOUT_CI_CHECKS,
        terminals,
      });
    },
    {
      initialProps: { overrides: initialOverrides, harness },
      wrapper: ({ children }: { children: ReactNode }) => (
        <ClientConnectionProvider connection={connection}>
          <SessionViewContext value={{ id: "view", isActive }}>{children}</SessionViewContext>
        </ClientConnectionProvider>
      ),
    },
  );
  return {
    ...view,
    starts: harness.starts,
    setTerminals: (overrides: Partial<TerminalSessionsModel>) => {
      latestOverrides = overrides;
      view.rerender({ overrides, harness });
    },
    setActive: (active: boolean) => {
      isActive = active;
      view.rerender({ overrides: latestOverrides, harness });
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
  outcomeUnknown: false,
  requestState: "creating",
});

/** Ends the close transition of a panel, as the panel split does on the page. */
export const expectPanelSlidesOut = (
  view: ReturnType<typeof renderPanels>,
  panel: PanelId,
): void => {
  expect(view.result.current[panel].isVisible).toBe(true);
  expect(view.result.current[panel].presence).toBe("closing");
  act(() => view.result.current[panel].onSettled());
  expect(view.result.current[panel].presence).toBe("closed");
  expect(view.result.current[panel].isVisible).toBe(false);
};

export const entryIdOf = (tabs: { id: string; kind: string }[], kind: string): string => {
  const tab = tabs.find((entry) => entry.kind === kind);
  if (!tab) throw new Error(`Expected a ${kind} tab.`);
  return tab.id;
};

export const TAB_1 = browserTabIdFixture(1);
export const TAB_2 = browserTabIdFixture(2);
export const DEFAULT_RIGHT_IDS = ["document", "diffs", "files"];

export const savedBrowserEntry = (tabId: string): BrowserTabEntry => ({
  id: `browser:${tabId}`,
  kind: "browser",
  tabId,
});

/** Saves the default tool tabs of a task and the given browser entries before the page shows. */
export const saveLayout = (
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

/** The calls that the panels made to the browser feature, in order. */
type BrowserFeatureCalls = { started: string[]; closed: string[] };

/** The values of one rendered controller that stay the same for its whole test. */
type BrowserHarness = { owner: SessionPanelOwner; scopeKey: string; calls: BrowserFeatureCalls };

type BrowserHarnessProps = {
  browser: Partial<SessionPanelBrowserModel>;
  terminals?: Partial<TerminalSessionsModel>;
  harness: BrowserHarness;
};

/** Renders the controller with a browser model that records each call to the browser feature. */
export const renderBrowserPanels = (
  owner: SessionPanelOwner,
  initialBrowser: Partial<SessionPanelBrowserModel>,
  {
    isActive: initialActive = true,
    terminals: initialTerminals = {},
  }: { isActive?: boolean; terminals?: Partial<TerminalSessionsModel> } = {},
) => {
  const harness: BrowserHarness = {
    owner,
    scopeKey: sessionPanelOwnerKey(owner),
    calls: { started: [], closed: [] },
  };
  let isActive = initialActive;
  let latest: BrowserHarnessProps = {
    browser: initialBrowser,
    terminals: initialTerminals,
    harness,
  };
  const view = renderHook(
    ({ browser, terminals: terminalOverrides, harness: current }: BrowserHarnessProps) => {
      const terminals = useMemo(
        () => createTerminalSessionsFixture({ scopeKey: current.scopeKey, ...terminalOverrides }),
        [current, terminalOverrides],
      );
      // The browser feature owns `openingTabIds` and `closingTabIds`. Each test gives them.
      const model = useMemo(
        () =>
          createSessionPanelBrowserFixture({
            scopeKey: current.scopeKey,
            startTab: (tabId) => current.calls.started.push(tabId),
            closeTab: async (tabId) => {
              current.calls.closed.push(tabId);
            },
            ...browser,
          }),
        [browser, current],
      );
      return useSessionPanels({
        owner: current.owner,
        selectionKey: "build",
        unavailableKinds: WITHOUT_CI_CHECKS,
        terminals,
        browser: model,
      });
    },
    {
      initialProps: latest,
      wrapper: ({ children }: { children: ReactNode }) => (
        <ClientConnectionProvider connection={connection}>
          <SessionViewContext value={{ id: "view", isActive }}>{children}</SessionViewContext>
        </ClientConnectionProvider>
      ),
    },
  );
  return {
    ...view,
    calls: harness.calls,
    setBrowser: (browser: Partial<SessionPanelBrowserModel>) => {
      latest = { ...latest, browser };
      view.rerender(latest);
    },
    setTerminals: (terminals: Partial<TerminalSessionsModel>) => {
      latest = { ...latest, terminals };
      view.rerender(latest);
    },
    setActive: (active: boolean) => {
      isActive = active;
      view.rerender(latest);
    },
  };
};

export const hostTab = (
  tabId: string,
  overrides: Partial<BrowserTabSummary> = {},
): BrowserTabSummary => createBrowserTabSummaryFixture({ tabId, ...overrides });
