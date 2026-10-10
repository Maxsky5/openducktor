import { describe, expect, mock, test } from "bun:test";
import type { TerminalSummary } from "@openducktor/contracts";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { TerminalTab } from "@/features/terminals";
import {
  createSessionPanelFixture,
  createSessionPanelsFixture,
} from "@/test-utils/session-panel-fixtures";
import { SessionPanel } from "./session-panel";
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

const toolTabs = {
  diffs: { content: <p>Diff content</p> },
  files: { content: <p>File tree</p> },
};

describe("SessionPanel", () => {
  test("shows each tab with its label, the selected tab, and a close button", () => {
    render(<SessionPanel model={createSessionPanelFixture()} toolTabs={toolTabs} />);

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

  test("keeps Files mounted while another tab shows, and mounts other tools only when selected", () => {
    render(<SessionPanel model={createSessionPanelFixture()} toolTabs={toolTabs} />);

    expect(screen.getByText("Diff content")).toBeDefined();
    expect(screen.getByText("File tree").closest("[hidden]")).not.toBeNull();
  });

  test("selects, closes, and adds tabs through the panel model", () => {
    const onSelect = mock((_entryId: string) => {});
    const onClose = mock((_entryId: string) => {});
    const onAddTab = mock(() => {});
    render(
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
    const view = render(
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
    render(
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
    render(<SessionPanel model={createSessionPanelFixture()} toolTabs={toolTabs} />);

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
    render(<SessionPanel model={bottom} toolTabs={toolTabs} />);
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
    render(
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
