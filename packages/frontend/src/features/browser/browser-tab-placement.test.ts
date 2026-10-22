import { describe, expect, test } from "bun:test";
import type { BrowserTabSummary } from "@openducktor/contracts";
import { browserTabEntry, type SessionPanelLayout } from "@/features/session-panels";
import {
  browserTabIdFixture,
  createBrowserTabSummaryFixture,
} from "@/test-utils/session-panel-fixtures";
import { browserTabPanelOwner, placeBrowserTab } from "./browser-tab-placement";

type PanelEntries = SessionPanelLayout["panels"]["right"];

const TAB_1 = browserTabIdFixture(1);
const TAB_2 = browserTabIdFixture(2);
const TAB_3 = browserTabIdFixture(3);
const TOOL_TABS: PanelEntries = [
  { id: "document", kind: "document" },
  { id: "diffs", kind: "diffs" },
  { id: "files", kind: "files" },
];
const TOOL_TAB_IDS = TOOL_TABS.map((entry) => entry.id);

const hostTab = (tabId: string, overrides: Partial<BrowserTabSummary> = {}): BrowserTabSummary =>
  createBrowserTabSummaryFixture({ tabId, ...overrides });

/** A shown task layout with its default tool tabs, then the given entries. */
const shownLayout = (
  right: PanelEntries,
  bottom: PanelEntries = [],
  selection: Pick<Partial<SessionPanelLayout>, "selectedRight" | "selectedBottom"> = {},
): SessionPanelLayout => ({
  panels: { right: [...TOOL_TABS, ...right], bottom },
  closedKinds: [],
  selectedRight: selection.selectedRight ?? {},
  selectedBottom: selection.selectedBottom ?? null,
});

const ids = (entries: PanelEntries): string[] => entries.map((entry) => entry.id);

describe("browser tab placement", () => {
  test("puts a popup right after its opener, and takes each selection of the opener", () => {
    const popup = hostTab(TAB_3, { openerTabId: TAB_1 });
    const bottom = shownLayout([], [browserTabEntry(TAB_1), browserTabEntry(TAB_2)], {
      selectedBottom: `browser:${TAB_1}`,
    });
    const right = shownLayout([browserTabEntry(TAB_1), browserTabEntry(TAB_2)], [], {
      selectedRight: { build: `browser:${TAB_1}`, spec: "document" },
    });

    const inBottom = placeBrowserTab(bottom, popup);
    const inRight = placeBrowserTab(right, popup);

    expect(ids(inBottom.panels.bottom)).toEqual([
      `browser:${TAB_1}`,
      `browser:${TAB_3}`,
      `browser:${TAB_2}`,
    ]);
    expect(inBottom.selectedBottom).toBe(`browser:${TAB_3}`);
    expect(ids(inRight.panels.right)).toEqual([
      ...TOOL_TAB_IDS,
      `browser:${TAB_1}`,
      `browser:${TAB_3}`,
      `browser:${TAB_2}`,
    ]);
    expect(inRight.selectedRight).toEqual({ build: `browser:${TAB_3}`, spec: "document" });
  });

  test("keeps the selection on the opener when a page opens a popup window", () => {
    const layout = shownLayout([browserTabEntry(TAB_1)], [], {
      selectedRight: { build: `browser:${TAB_1}` },
    });

    const next = placeBrowserTab(
      layout,
      hostTab(TAB_2, { openerTabId: TAB_1, surface: "popup_window" }),
    );

    expect(ids(next.panels.right)).toEqual([
      ...TOOL_TAB_IDS,
      `browser:${TAB_1}`,
      `browser:${TAB_2}`,
    ]);
    expect(next.selectedRight).toEqual({ build: `browser:${TAB_1}` });
  });

  test("keeps the layout for a placed tab and for a tab that waits for a page of its owner", () => {
    const layout = shownLayout([browserTabEntry(TAB_1), browserTabEntry(TAB_2)]);

    expect(placeBrowserTab(layout, hostTab(TAB_1, { url: "http://localhost:3000/new" }))).toBe(
      layout,
    );
    // A user tab, a saved agent tab, and a popup of an unplaced opener wait for the reconcile of a
    // page that shows the owner.
    expect(placeBrowserTab(layout, hostTab(TAB_3))).toBe(layout);
    expect(placeBrowserTab(layout, hostTab(TAB_3, { createdBy: "agent", started: false }))).toBe(
      layout,
    );
    const orphan = hostTab(TAB_3, { createdBy: "agent", openerTabId: browserTabIdFixture(4) });
    expect(placeBrowserTab(layout, orphan)).toBe(layout);
  });

  test("puts an agent tab at the end of the right panel of its owner and selects it", () => {
    const entryId = `browser:${TAB_1}`;
    const agentTab = hostTab(TAB_1, { createdBy: "agent" });

    const placed = placeBrowserTab(
      shownLayout([], [], { selectedRight: { build: "files" } }),
      agentTab,
    );
    expect(ids(placed.panels.right)).toEqual([...TOOL_TAB_IDS, entryId]);
    expect(placed.selectedRight).toEqual({
      spec: entryId,
      planner: entryId,
      build: entryId,
      qa: entryId,
    });
    expect(placeBrowserTab(placed, agentTab)).toBe(placed);

    const chatTab = hostTab(TAB_2, {
      createdBy: "agent",
      owner: { kind: "workspace_session", workspaceId: "workspace-1", sessionId: "session-1" },
    });
    const chat = placeBrowserTab(
      {
        panels: { right: [], bottom: [] },
        closedKinds: [],
        selectedRight: {},
        selectedBottom: null,
      },
      chatTab,
    );
    expect(ids(chat.panels.right)).toEqual(["diffs", "files", `browser:${TAB_2}`]);
    expect(chat.selectedRight).toEqual({ chat: `browser:${TAB_2}` });
  });

  test("gives a Workspace Session tab to the chat of the session", () => {
    expect(
      browserTabPanelOwner({ kind: "task", workspaceId: "workspace-1", taskId: "task-1" }),
    ).toEqual({ kind: "task", workspaceId: "workspace-1", taskId: "task-1" });
    expect(
      browserTabPanelOwner({
        kind: "workspace_session",
        workspaceId: "workspace-1",
        sessionId: "session-1",
      }),
    ).toEqual({ kind: "chat", workspaceId: "workspace-1", sessionId: "session-1" });
  });
});
