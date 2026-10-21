import { BROWSER_FORWARDED_SHORTCUTS } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useBrowserAnnotationStore } from "@/features/browser-annotations";
import {
  browserEntryId,
  removePanelEntry,
  type SessionPanelOwner,
  useSessionPanelLayoutStore,
} from "@/features/session-panels";
import { useWorkspacePresence, useWorkspaceState } from "@/state/app-state-provider";
import { platformQueryOptions } from "@openducktor/frontend-core/queries/system";
import { useBrowserDevToolsStore } from "./browser-devtools-store";
import { useBrowserRecentPages } from "./browser-recent-pages";
import { useBrowserRuntime } from "./browser-runtime";
import { browserTabPanelOwner, placeBrowserTab } from "./browser-tab-placement";
import { browserNoticeText } from "./components/browser-notice-text";

/** Runs the browser tab coordinator for the app shell. Renders nothing. */
export function BrowserTabCoordinator() {
  const platform = useQuery(platformQueryOptions()).data ?? "unknown";
  useBrowserTabCoordinator(platform);
  useRecentPagesPruning();
  return null;
}

/** Forgets the recent pages of removed workspaces, once the workspace lists are current. */
const useRecentPagesPruning = (): void => {
  const recentPages = useBrowserRecentPages();
  const { workspaces, closedWorkspaces } = useWorkspaceState();
  const { workspaceRecordsAreCurrent } = useWorkspacePresence();
  const workspaceIds = useMemo(
    () =>
      workspaceRecordsAreCurrent
        ? new Set([...workspaces, ...closedWorkspaces].map((workspace) => workspace.workspaceId))
        : null,
    [closedWorkspaces, workspaceRecordsAreCurrent, workspaces],
  );
  useEffect(() => {
    if (workspaceIds !== null) recentPages.prune(workspaceIds);
  }, [recentPages, workspaceIds]);
};

/**
 * Keeps the panels of every owner in step with the host tabs, also for owners whose page does not
 * show: a closed tab leaves its panel, a new popup goes after its opener, a new agent tab goes to
 * the end of the right panel, and pruned owners lose their pending annotations. It
 * also records the recent pages, shows tab notices and save failures, and runs forwarded
 * shortcuts.
 */
const useBrowserTabCoordinator = (platform: string): void => {
  const runtime = useBrowserRuntime();
  const layoutStore = useSessionPanelLayoutStore();
  const recentPages = useBrowserRecentPages();
  const annotationStore = useBrowserAnnotationStore();

  useEffect(
    () =>
      runtime.store.onChange((change) => {
        if (change.kind === "tab_closed") {
          layoutStore.update(browserTabPanelOwner(change.owner), (layout) =>
            removePanelEntry(layout, browserEntryId(change.tabId)),
          );
          useBrowserDevToolsStore.getState().forget(change.tabId);
          return;
        }
        if (change.kind === "tab_added" || change.kind === "tab_updated") {
          layoutStore.update(browserTabPanelOwner(change.tab.owner), (layout) =>
            placeBrowserTab(layout, change.tab),
          );
          recentPages.record(change.tab);
          return;
        }
        if (change.kind === "tabs_not_saved") {
          toast.error("Could not save the browser tabs", { description: change.message });
          return;
        }
        const text = browserNoticeText(change.notice);
        if (text.tone === "warning") {
          toast.warning(text.title, { description: text.description });
          return;
        }
        toast.info(text.title, { description: text.description });
      }),
    [layoutStore, recentPages, runtime],
  );

  useEffect(
    () =>
      // The host closes the tabs of a deleted task or an archived chat. Annotations are client data.
      layoutStore.subscribePrunes((owners) => {
        for (const owner of owners) {
          annotationStore.getState().removeOwner(annotationOwner(owner));
        }
      }),
    [annotationStore, layoutStore],
  );

  useEffect(() => {
    if (runtime.surface !== "webview") return;
    return runtime.channel.subscribe((message) => {
      if (message.type === "shortcut") dispatchShortcut(message.shortcut, platform);
      if (message.type === "protocol_error") {
        toast.error("A browser tab action failed", { description: message.failure.message });
      }
    });
  }, [runtime, platform]);
};

/** Sends a forwarded OpenDucktor shortcut to the app, as if the window had the keyboard focus. */
const dispatchShortcut = (id: string, platform: string): void => {
  const shortcut = BROWSER_FORWARDED_SHORTCUTS.find((candidate) => candidate.id === id);
  if (!shortcut) return;
  const useMeta = shortcut.modifier === "mod" && platform === "darwin";
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: shortcut.key,
      metaKey: useMeta,
      ctrlKey: !useMeta,
      bubbles: true,
      cancelable: true,
    }),
  );
};

/** The annotation owner of the session panel layout that OpenDucktor pruned. */
const annotationOwner = (owner: SessionPanelOwner) =>
  owner.kind === "task"
    ? { kind: "task" as const, workspaceId: owner.workspaceId, taskId: owner.taskId }
    : {
        kind: "workspace_session" as const,
        workspaceId: owner.workspaceId,
        sessionId: owner.sessionId,
      };
