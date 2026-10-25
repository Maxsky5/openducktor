import { describe, expect, mock, test } from "bun:test";
import {
  type BrowserTabSummary,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalSummary,
} from "@openducktor/contracts";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactElement, useCallback, useState } from "react";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
  createTerminalSessionsFixture,
  createSessionPanelFixture,
  createSessionPanelsFixture,
} from "@/test-utils/session-panel-fixtures";
import { createTerminalActivityStore } from "@openducktor/frontend-core/terminals/terminal-activity-store";
import { createTerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import { SessionPanel } from "./session-panel";
import {
  SessionViewContext,
  SessionViewShownContext,
} from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import type { BrowserTabViewProps } from "./use-session-panel-browser-tabs";
import type { ResolvedBrowserTab } from "./session-panel-layout";
import { SessionPanelsRoot } from "./session-panels-root";

const terminal: TerminalTab = {
  tabId: "tab:terminal-1",
  terminalId: "terminal-1",
  summary: {
    terminalId: "terminal-1",
    label: "bun run dev",
    context: { repoPath: "/repo", taskId: "task-1" },
    initialWorkingDir: "/repo",
    createdAt: "2026-10-09T00:00:00.000Z",
    lifecycle: "running",
    exit: null,
    startedBy: "user",
  } satisfies TerminalSummary,
  awaitingLifecycleSync: false,
  error: null,
  requestState: "ready",
};

// The tab strip reads the host client of its connection for terminal restarts.
const renderWithConnection = (ui: ReactElement) => render(ui, { wrapper: QueryProvider });

const toolTabs = {
  diffs: { content: <p>Diff content</p> },
  files: { content: <p>File tree</p> },
};

test("an inactive panel root closes its terminal confirmation and keeps its content mounted", () => {
  const confirm = mock(() => {});
  let showConfirmation!: () => void;
  function Harness({
    isActive,
    hideCandidate = true,
  }: {
    isActive: boolean;
    hideCandidate?: boolean;
  }) {
    const [candidate, setCandidate] = useState<TerminalTab | null>(terminal);
    showConfirmation = () => setCandidate(terminal);
    const cancel = useCallback(() => setCandidate(null), []);
    const panels = createSessionPanelsFixture({
      terminalClose: {
        candidate: hideCandidate && !isActive ? null : candidate,
        isConfirming: false,
        onCancel: cancel,
        onConfirm: confirm,
      },
    });
    return (
      <SessionPanelsRoot panels={panels} isActive={isActive}>
        <input data-testid="kept-content" />
      </SessionPanelsRoot>
    );
  }
  const view = renderWithConnection(<Harness isActive />);
  const content = view.getByTestId("kept-content");
  const dialog = view.getByRole("dialog", { name: "Terminate and close bun run dev?" });
  view.rerender(<Harness isActive={false} />);
  expect(dialog.isConnected).toBe(false);
  expect(content.isConnected).toBe(true);
  view.rerender(<Harness isActive />);
  expect(view.queryAllByRole("dialog").length).toBe(0);
  view.rerender(<Harness isActive={false} hideCandidate={false} />);
  act(() => showConfirmation());
  view.rerender(<Harness isActive hideCandidate={false} />);
  expect(view.queryAllByRole("dialog").length).toBe(0);
  expect(view.getByTestId("kept-content")).toBe(content);
  expect(confirm).not.toHaveBeenCalled();
  view.unmount();
});

test("a hidden panel root closes its terminal confirmation before its content turns inactive", () => {
  const cancel = mock(() => {});
  const root = (isShown: boolean) => (
    <SessionViewContext value={{ id: "view", isActive: true }}>
      <SessionViewShownContext value={isShown}>
        <SessionPanelsRoot
          panels={createSessionPanelsFixture({
            terminalClose: {
              candidate: terminal,
              isConfirming: false,
              onCancel: cancel,
              onConfirm: () => {},
            },
          })}
        >
          <input data-testid="kept-content" />
        </SessionPanelsRoot>
      </SessionViewShownContext>
    </SessionViewContext>
  );
  const view = renderWithConnection(root(true));
  expect(view.getByRole("dialog", { name: "Terminate and close bun run dev?" })).toBeDefined();
  view.rerender(root(false));
  expect(view.queryAllByRole("dialog")).toHaveLength(0);
  expect(cancel).toHaveBeenCalled();
  view.unmount();
});

describe("SessionPanel", () => {
  test("a view that shows again paints its panel before its content turns active", () => {
    const model = createSessionPanelFixture();
    const panel = (isShown: boolean, isActive: boolean) => (
      <SessionViewContext value={{ id: "view", isActive }}>
        <SessionViewShownContext value={isShown}>
          <SessionPanel model={model} />
        </SessionViewShownContext>
      </SessionViewContext>
    );
    const view = renderWithConnection(panel(true, true));
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    view.rerender(panel(false, false));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    // The content turns active one frame after the view shows.
    view.rerender(panel(true, false));
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
  });

  test("shows each tab with its label, the selected tab, and a close button", () => {
    renderWithConnection(<SessionPanel model={createSessionPanelFixture()} toolTabs={toolTabs} />);

    const tablist = screen.getByRole("tablist", { name: "Right panel tabs" });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Diffs", "Files"]);
    expect(screen.getByRole("tab", { name: "Diffs" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Close Diffs" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Close Files" })).toBeDefined();
    expect(screen.getByRole("button", { name: "New tab in the right panel" })).toBeDefined();
  });

  test("rings a tab with the neutral color only for keyboard focus", () => {
    renderWithConnection(<SessionPanel model={createSessionPanelFixture()} toolTabs={toolTabs} />);

    const tab = screen.getByRole("tab", { name: "Diffs" });
    expect(tab.className).toContain("outline-none");
    expect(tab.className).toContain("focus-visible:ring-2 focus-visible:ring-ring");
    expect(tab.className).not.toMatch(/(?:^|\s)focus:ring/);
  });

  test("offers Restart in the tab header only for the selected terminal", () => {
    const store = createTerminalActivityStore();
    for (const message of [
      { version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_start" },
      { version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_end" },
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "activity_updated",
        activity: { summary: terminal.summary, command: "bun dev", restartable: true },
      },
    ] as const)
      store.apply(message);
    const controller = {
      ...createTerminalTransportController(
        { connect: async () => ({ send: async () => {}, close: () => {} }) },
        () => {},
      ),
      readActivity: store.read,
      subscribeActivity: store.subscribe,
    };
    const model = createSessionPanelFixture({
      tabs: [
        { id: "files", kind: "files" },
        { id: "terminal-1", kind: "terminal", terminal },
      ],
      selectedTabId: "terminal-1",
      terminals: createTerminalSessionsFixture({ controller }),
    });
    const view = renderWithConnection(<SessionPanel model={model} toolTabs={toolTabs} />);
    const add = screen.getByRole("button", { name: "New tab in the right panel" });
    expect(
      add.parentElement?.contains(screen.getByRole("button", { name: "Restart command" })),
    ).toBe(true);
    view.rerender(
      <SessionPanel model={{ ...model, selectedTabId: "files" }} toolTabs={toolTabs} />,
    );
    expect(screen.queryByRole("button", { name: "Restart command" })).toBeNull();
    view.rerender(<SessionPanel model={model} toolTabs={toolTabs} />);
    expect(screen.getByRole("button", { name: "Restart command" })).toBeDefined();
  });

  test("keeps Files mounted while another tab shows, and mounts other tools only when selected", () => {
    renderWithConnection(<SessionPanel model={createSessionPanelFixture()} toolTabs={toolTabs} />);

    expect(screen.getByText("Diff content")).toBeDefined();
    expect(screen.getByText("File tree").closest("[hidden]")).not.toBeNull();
  });

  test("selects, closes, and adds tabs through the panel model", () => {
    const onSelect = mock((_entryId: string) => {});
    const onClose = mock((_entryId: string) => {});
    const onAddTab = mock(() => {});
    renderWithConnection(
      <SessionPanel
        model={createSessionPanelFixture({ onSelect, onClose, onAddTab })}
        toolTabs={toolTabs}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Files" }), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Close Diffs" }));
    fireEvent.click(screen.getByRole("button", { name: "New tab in the right panel" }));

    expect(onSelect).toHaveBeenCalledWith("files");
    expect(onClose).toHaveBeenCalledWith("diffs");
    expect(onAddTab).toHaveBeenCalledTimes(1);
  });

  test("shows the New tab launcher in an empty right panel and in a New tab", () => {
    const onPick = mock((_kind: string) => {});
    const launcher = [
      { kind: "diffs" as const, disabledReason: null },
      { kind: "terminal" as const, disabledReason: "Close a terminal to start another." },
    ];
    const view = renderWithConnection(
      <SessionPanel
        model={createSessionPanelFixture({ tabs: [], selectedTabId: null, launcher, onPick })}
      />,
    );

    const diffsCard = screen.getByRole("button", { name: "Diffs" });
    expect(diffsCard.textContent).toContain("Review the code changes.");
    fireEvent.click(diffsCard);
    const terminalEntry = screen.getByRole("button", { name: "Terminal" });
    expect(terminalEntry.hasAttribute("disabled")).toBe(true);
    const reasonId = terminalEntry.getAttribute("aria-describedby");
    expect(reasonId ? document.getElementById(reasonId)?.textContent : null).toBe(
      "Close a terminal to start another.",
    );
    expect(onPick).toHaveBeenCalledWith("diffs");

    view.rerender(
      <SessionPanel
        model={createSessionPanelFixture({
          tabs: [{ id: "new_tab:right", kind: "new_tab" }],
          selectedTabId: "new_tab:right",
          launcher,
          onPick,
        })}
      />,
    );
    expect(screen.getByRole("tab", { name: "New tab" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("region", { name: "Open a tab" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Tools" })).toBeNull();
  });

  test("offers to move a terminal to the other panel from its actions menu", () => {
    const onMove = mock((_entryId: string, _to: string) => {});
    const bottom = createSessionPanelFixture({
      panel: "bottom",
      tabs: [{ id: "terminal:tab:terminal-1", kind: "terminal", terminal }],
      selectedTabId: "terminal:tab:terminal-1",
      onHide: () => {},
    });
    renderWithConnection(
      <SessionPanelsRoot
        panels={createSessionPanelsFixture({
          bottom,
          canMove: (_entryId, to) => to === "right",
          onMove,
        })}
      >
        <SessionPanel model={bottom} />
      </SessionPanelsRoot>,
    );
    const tab = screen.getByRole("tab", { name: "bun run dev, Running" });

    fireEvent.keyDown(tab, { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to right panel" }));

    expect(onMove).toHaveBeenCalledWith("terminal:tab:terminal-1", "right");
    expect(screen.getByRole("button", { name: "Back to workspace" })).toBeDefined();
  });

  test("does not offer a move for a tab that only one panel allows", async () => {
    renderWithConnection(<SessionPanel model={createSessionPanelFixture()} toolTabs={toolTabs} />);

    await act(async () => {
      fireEvent.contextMenu(screen.getByRole("tab", { name: "Diffs" }));
    });

    expect(screen.queryByRole("menuitem", { name: /Move to/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Close tab" })).toBeDefined();
  });

  test("shows the full tab label only when the tab cuts it off, above a bottom panel tab", async () => {
    const bottom = createSessionPanelFixture({
      panel: "bottom",
      tabs: [
        { id: "diffs", kind: "diffs" },
        { id: "terminal:tab:terminal-1", kind: "terminal", terminal },
      ],
      selectedTabId: "diffs",
    });
    renderWithConnection(<SessionPanel model={bottom} toolTabs={toolTabs} />);
    const terminalTab = screen.getByRole("tab", { name: "bun run dev, Running" });
    const terminalLabel = within(terminalTab).getByText("bun run dev");
    // The test DOM has no layout, so the label width tells the tab that it cuts the label off.
    Object.defineProperty(terminalLabel, "scrollWidth", { configurable: true, value: 240 });
    Object.defineProperty(terminalLabel, "clientWidth", { configurable: true, value: 120 });

    await act(async () => {
      fireEvent.focus(screen.getByRole("tab", { name: "Diffs" }));
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.blur(screen.getByRole("tab", { name: "Diffs" }));

    await act(async () => {
      fireEvent.focus(terminalTab);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("bun run dev");
    expect(document.querySelector('[data-slot="tooltip-content"]')?.getAttribute("data-side")).toBe(
      "top",
    );
  });

  test("names a tool tab with its status when the page gives one", () => {
    renderWithConnection(
      <SessionPanel
        model={createSessionPanelFixture({
          tabs: [{ id: "ci_checks", kind: "ci_checks" }],
          selectedTabId: "ci_checks",
        })}
        toolTabs={{
          ci_checks: {
            content: <p>Checks</p>,
            ariaLabel: "CI Checks, failing checks",
            indicator: <span data-testid="ci-indicator" />,
          },
        }}
      />,
    );

    expect(screen.getByRole("tab", { name: "CI Checks, failing checks" })).toBeDefined();
    expect(screen.getByTestId("ci-indicator")).toBeDefined();
  });
});

const TAB_1 = browserTabIdFixture(1);
const TAB_2 = browserTabIdFixture(2);
const TAB_3 = browserTabIdFixture(3);
const TAB_4 = browserTabIdFixture(4);
const FAVICON = "data:image/png;base64,iVBORw0KGgo=";

const browserTab = (tabId: string, tab: Partial<BrowserTabSummary> | null): ResolvedBrowserTab => ({
  id: `browser:${tabId}`,
  kind: "browser",
  entry: { id: `browser:${tabId}`, kind: "browser", tabId },
  tab: tab === null ? null : createBrowserTabSummaryFixture({ tabId, ...tab }),
});

describe("SessionPanel browser tabs", () => {
  test("fills browser tabs from the browser view and keeps them mounted", () => {
    const page = browserTab(TAB_1, {});
    const other = browserTab(TAB_2, {});
    const views: BrowserTabViewProps[] = [];
    renderWithConnection(
      <SessionPanel
        model={createSessionPanelFixture({
          panel: "bottom",
          tabs: [page, other],
          selectedTabId: page.id,
          browserAddressFocus: { tabId: TAB_1, request: 2 },
          browserTabView: (props) => {
            views.push(props);
            return <p>{props.tab.entry.tabId} view</p>;
          },
        })}
      />,
    );

    expect(screen.getByText(`${TAB_1} view`).closest("[hidden]")).toBeNull();
    expect(screen.getByText(`${TAB_2} view`).closest("[hidden]")).not.toBeNull();
    expect(views.find((view) => view.tab === page)).toEqual({
      tab: page,
      isShown: true,
      addressFocusRequest: 2,
    });
    expect(views.find((view) => view.tab === other)).toEqual({
      tab: other,
      isShown: false,
      addressFocusRequest: 0,
    });
  });

  test("does not show the selected browser tab of a closed panel", () => {
    const page = browserTab(TAB_1, {});
    const views: BrowserTabViewProps[] = [];
    renderWithConnection(
      <SessionPanel
        model={createSessionPanelFixture({
          panel: "bottom",
          presence: "closed",
          tabs: [page],
          selectedTabId: page.id,
          browserTabView: (props) => {
            views.push(props);
            return <p>browser view</p>;
          },
        })}
      />,
    );

    expect(views.at(-1)?.isShown).toBe(false);
  });

  test("names each browser tab with its page, owner badge, activity, and popup window", () => {
    const dashboard = browserTab(TAB_1, { title: "Dashboard", favicon: FAVICON, shared: true });
    const login = browserTab(TAB_2, {
      title: null,
      url: "http://localhost:5173/login",
      createdBy: "agent",
      agentActive: true,
      prompts: [
        {
          promptId: "prompt-1",
          kind: "dialog",
          type: "alert",
          message: "Saved",
          defaultPrompt: "",
          startedByAgent: true,
        },
      ],
    });
    const blank = browserTab(TAB_3, null);
    const popup = browserTab(TAB_4, {
      title: "Sign in",
      favicon: FAVICON,
      surface: "popup_window",
      openerTabId: TAB_1,
    });
    const tabs = [dashboard, login, blank, popup];
    const view = renderWithConnection(
      <SessionPanel model={createSessionPanelFixture({ tabs, selectedTabId: dashboard.id })} />,
    );

    const tablist = screen.getByRole("tablist", { name: "Right panel tabs" });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("aria-label")),
    ).toEqual([
      "Dashboard, shared with agents",
      "localhost:5173, agent tab, an agent uses the page, waits for your answer",
      "Blank page",
      "Sign in, open in a popup window",
    ]);
    const dashboardTab = screen.getByRole("tab", { name: "Dashboard, shared with agents" });
    expect(dashboardTab.querySelector("img")?.getAttribute("src")).toBe(FAVICON);
    expect(dashboardTab.textContent).toBe("DashboardShared");
    const loginTab = screen.getByRole("tab", { name: /^localhost:5173/ });
    expect(loginTab.textContent).toBe("localhost:5173Agent");
    expect(
      [...loginTab.querySelectorAll("[data-panel-tab-mark]")].map((mark) =>
        mark.getAttribute("data-panel-tab-mark"),
      ),
    ).toEqual(["agent-active", "prompts"]);
    // A popup window tab shows a window icon, not the page favicon.
    expect(
      screen.getByRole("tab", { name: "Sign in, open in a popup window" }).querySelector("img"),
    ).toBeNull();

    // The selected tab shows its prompt in its content, so its label has no prompt mark.
    view.rerender(
      <SessionPanel model={createSessionPanelFixture({ tabs, selectedTabId: login.id })} />,
    );
    expect(
      screen.getByRole("tab", { name: "localhost:5173, agent tab, an agent uses the page" }),
    ).toBeDefined();
  });

  test("shows the full page URL in the tooltip of a browser tab", async () => {
    renderWithConnection(
      <SessionPanel
        model={createSessionPanelFixture({
          tabs: [browserTab(TAB_1, { title: "Dashboard", url: "http://localhost:3000/a/b?c=1" })],
          selectedTabId: `browser:${TAB_1}`,
        })}
      />,
    );

    await act(async () => {
      fireEvent.focus(screen.getByRole("tab", { name: "Dashboard" }));
    });

    expect(screen.getByRole("tooltip").textContent).toBe("Dashboardhttp://localhost:3000/a/b?c=1");
  });

  test("offers a Browser card with its reason when a new browser tab cannot open", () => {
    renderWithConnection(
      <SessionPanel
        model={createSessionPanelFixture({
          tabs: [],
          selectedTabId: null,
          launcher: [{ kind: "browser", disabledReason: "Open OpenDucktor in a window first." }],
        })}
      />,
    );

    const card = screen.getByRole("button", { name: "Browser" });
    expect(card.hasAttribute("disabled")).toBe(true);
    expect(card.textContent).toContain("Open OpenDucktor in a window first.");
  });
});
