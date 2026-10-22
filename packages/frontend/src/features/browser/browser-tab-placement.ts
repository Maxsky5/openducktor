import type { BrowserTabOwner, BrowserTabSummary } from "@openducktor/contracts";
import {
  appendRightPanelEntry,
  browserEntryId,
  browserTabEntry,
  findPanelTab,
  insertPanelEntryAfter,
  type SessionPanelLayout,
  type SessionPanelOwner,
} from "@/features/session-panels";

/** The panel owner of a browser tab. A Workspace Session tab belongs to the chat of the session. */
export const browserTabPanelOwner = (owner: BrowserTabOwner): SessionPanelOwner =>
  owner.kind === "task"
    ? { kind: "task", workspaceId: owner.workspaceId, taskId: owner.taskId }
    : { kind: "chat", workspaceId: owner.workspaceId, sessionId: owner.sessionId };

/**
 * Places a new host tab in the layout of its owner, whether the page of the owner shows or not.
 * A new popup goes right after its opener. A panel popup takes each selection of its opener, so
 * the user sees the page that the opener opened. A new agent tab that no page opened goes to the
 * end of the right panel and takes its selection. Any other tab without an entry, such as a saved
 * tab that has not started, waits for the reconcile of a page that shows the owner.
 */
export const placeBrowserTab = (
  layout: SessionPanelLayout,
  tab: BrowserTabSummary,
): SessionPanelLayout => {
  const entry = browserTabEntry(tab.tabId);
  if (!tab.started || findPanelTab(layout, entry.id)) return layout;
  if (tab.openerTabId !== null) {
    return insertPanelEntryAfter(layout, browserEntryId(tab.openerTabId), entry, {
      takeSelection: tab.surface === "panel",
    });
  }
  if (tab.createdBy !== "agent") return layout;
  return appendRightPanelEntry(layout, browserTabPanelOwner(tab.owner).kind, entry);
};
