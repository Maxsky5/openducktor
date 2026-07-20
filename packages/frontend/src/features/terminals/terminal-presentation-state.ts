import { arrayMove } from "@dnd-kit/sortable";
import type { TerminalLifecycle, TerminalSummary } from "@openducktor/contracts";

type ReadyTerminalTab = {
  tabId: string;
  terminalId: string;
  summary: TerminalSummary;
  awaitingLifecycleSync: boolean;
  error: null;
  requestState: "ready";
};

type PendingTerminalTab = {
  tabId: string;
  terminalId: null;
  summary: null;
  label: string;
  error: string | null;
  requestState: "creating" | "creation_failed" | "unsupported_runtime" | "lost";
};

export type TerminalTab = ReadyTerminalTab | PendingTerminalTab;

export const terminalTabLabel = (tab: TerminalTab): string =>
  tab.requestState === "ready" ? tab.summary.label : tab.label;

export const terminalTabLifecycle = (tab: TerminalTab): TerminalLifecycle | null =>
  tab.requestState === "ready" ? tab.summary.lifecycle : null;

export type TerminalScopePresentation = {
  hostInstanceId: string | null;
  tabs: TerminalTab[];
  closingTabIds: string[];
  activeTabId: string | null;
  visibility: { value: boolean; isExplicit: boolean };
  focusRequest: number;
};

export type TerminalPresentationState = {
  activeScopeKey: string | null;
  scopes: Record<string, TerminalScopePresentation>;
};

export type TerminalPresentationEvent =
  | { type: "scopeActivated"; scopeKey: string | null }
  | {
      type: "hostSynced";
      scopeKey: string;
      hostInstanceId: string;
      summaries: TerminalSummary[];
    }
  | { type: "creationStarted"; scopeKey: string; tabId: string; label: string; retry: boolean }
  | {
      type: "creationFailed";
      scopeKey: string;
      tabId: string;
      requestState: "creation_failed" | "unsupported_runtime";
      error: string;
    }
  | { type: "creationCompleted"; scopeKey: string; tabId: string; summary: TerminalSummary }
  | { type: "visibilitySet"; scopeKey: string; value: boolean; isExplicit: boolean }
  | { type: "focusRequested"; scopeKey: string }
  | { type: "tabSelected"; scopeKey: string; tabId: string }
  | {
      type: "tabReordered";
      scopeKey: string;
      draggedTabId: string;
      targetTabId: string;
      position: "before" | "after";
    }
  | { type: "closeStarted"; scopeKey: string; tabId: string }
  | { type: "closeRejected"; scopeKey: string; tabId: string }
  | { type: "closeCompleted"; scopeKey: string; tabId: string }
  | { type: "titleChanged"; scopeKey: string; terminalId: string; title: string }
  | { type: "lifecycleChanged"; scopeKey: string; terminalId: string; lifecycle: TerminalLifecycle }
  | { type: "terminalForgotten"; scopeKey: string; terminalId: string; message: string };

export const emptyTerminalScopePresentation = (): TerminalScopePresentation => ({
  hostInstanceId: null,
  tabs: [],
  closingTabIds: [],
  activeTabId: null,
  visibility: { value: false, isExplicit: false },
  focusRequest: 0,
});

export const createTerminalPresentationState = (
  scopeKey: string | null,
): TerminalPresentationState => ({
  activeScopeKey: scopeKey,
  scopes: scopeKey ? { [scopeKey]: emptyTerminalScopePresentation() } : {},
});

export const toHostTab = (summary: TerminalSummary, previous?: TerminalTab): TerminalTab => {
  const previousSummary = previous?.requestState === "ready" ? previous.summary : null;
  const previousLabel = previous ? terminalTabLabel(previous) : null;
  const preserveLiveLifecycle =
    previous?.requestState === "ready" &&
    previous.awaitingLifecycleSync &&
    previous.summary.lifecycle !== summary.lifecycle;
  return {
    tabId: previous?.tabId ?? `tab:${summary.terminalId}`,
    terminalId: summary.terminalId,
    summary: previousSummary
      ? {
          ...summary,
          label: previousLabel ?? summary.label,
          lifecycle: preserveLiveLifecycle ? previousSummary.lifecycle : summary.lifecycle,
        }
      : { ...summary, label: previousLabel ?? summary.label },
    awaitingLifecycleSync: preserveLiveLifecycle,
    error: null,
    requestState: "ready",
  };
};

const toLostTab = (tab: ReadyTerminalTab, message: string): PendingTerminalTab => ({
  tabId: tab.tabId,
  terminalId: null,
  summary: null,
  label: terminalTabLabel(tab),
  error: `${message} It cannot be recovered or recreated automatically.`,
  requestState: "lost",
});

const resolveActiveTabId = (
  tabs: TerminalTab[],
  currentActiveTabId: string | null,
  preferredActiveTabId: string | null = null,
): string | null => {
  if (tabs.some((tab) => tab.tabId === currentActiveTabId)) return currentActiveTabId;
  if (tabs.some((tab) => tab.tabId === preferredActiveTabId)) return preferredActiveTabId;
  return tabs[0]?.tabId ?? null;
};

const updateScope = (
  state: TerminalPresentationState,
  scopeKey: string,
  update: (scope: TerminalScopePresentation) => TerminalScopePresentation,
): TerminalPresentationState => ({
  ...state,
  scopes: {
    ...state.scopes,
    [scopeKey]: update(state.scopes[scopeKey] ?? emptyTerminalScopePresentation()),
  },
});

const reconcileHostTabs = (
  scope: TerminalScopePresentation,
  hostInstanceId: string,
  summaries: TerminalSummary[],
): TerminalScopePresentation => {
  if (scope.hostInstanceId !== null && scope.hostInstanceId !== hostInstanceId) {
    const previousHostTabs = scope.tabs.map((tab) =>
      tab.requestState === "ready" ? toLostTab(tab, "The terminal host restarted.") : tab,
    );
    const tabs = [...previousHostTabs, ...summaries.map((summary) => toHostTab(summary))];
    const closingTabIds = scope.closingTabIds.filter((tabId) =>
      tabs.some((tab) => tab.tabId === tabId),
    );
    const closingTabIdSet = new Set(closingTabIds);
    const selectableTabs = tabs.filter((tab) => !closingTabIdSet.has(tab.tabId));
    return {
      ...scope,
      hostInstanceId,
      tabs,
      closingTabIds,
      activeTabId: resolveActiveTabId(selectableTabs, scope.activeTabId),
    };
  }
  const transient = scope.tabs.filter((tab) => tab.terminalId === null);
  const currentTabsByTerminalId = new Map(
    scope.tabs.flatMap((tab) => (tab.terminalId ? [[tab.terminalId, tab] as const] : [])),
  );
  const summariesByTerminalId = new Map(
    summaries.map((summary) => [summary.terminalId, summary] as const),
  );
  const hostTabs = scope.tabs.flatMap((tab) => {
    if (!tab.terminalId) return [];
    const summary = summariesByTerminalId.get(tab.terminalId);
    return summary ? [toHostTab(summary, tab)] : [];
  });
  const knownTerminalIds = new Set(hostTabs.map((tab) => tab.terminalId));
  for (const summary of summaries) {
    if (!knownTerminalIds.has(summary.terminalId)) {
      hostTabs.push(toHostTab(summary, currentTabsByTerminalId.get(summary.terminalId)));
    }
  }
  const tabs = [...hostTabs, ...transient];
  const closingTabIds = scope.closingTabIds.filter((tabId) =>
    tabs.some((tab) => tab.tabId === tabId),
  );
  const closingTabIdSet = new Set(closingTabIds);
  const selectableTabs = tabs.filter((tab) => !closingTabIdSet.has(tab.tabId));
  return {
    ...scope,
    hostInstanceId,
    tabs,
    closingTabIds,
    activeTabId: resolveActiveTabId(selectableTabs, scope.activeTabId),
  };
};

export const terminalPresentationReducer = (
  state: TerminalPresentationState,
  event: TerminalPresentationEvent,
): TerminalPresentationState => {
  if (event.type === "scopeActivated") {
    if (!event.scopeKey) return { ...state, activeScopeKey: null };
    const activated = updateScope(state, event.scopeKey, (scope) => ({
      ...scope,
      visibility: { value: false, isExplicit: false },
      focusRequest: 0,
    }));
    return { ...activated, activeScopeKey: event.scopeKey };
  }
  return updateScope(state, event.scopeKey, (scope) => {
    if (event.type === "hostSynced")
      return reconcileHostTabs(scope, event.hostInstanceId, event.summaries);
    if (event.type === "creationStarted") {
      const tabs = event.retry
        ? scope.tabs.map((tab) => {
            if (tab.tabId !== event.tabId || tab.requestState === "ready") return tab;
            return { ...tab, requestState: "creating" as const, error: null };
          })
        : [
            ...scope.tabs,
            {
              tabId: event.tabId,
              terminalId: null,
              summary: null,
              label: event.label,
              error: null,
              requestState: "creating" as const,
            },
          ];
      return {
        ...scope,
        tabs,
        activeTabId: event.tabId,
        focusRequest: scope.focusRequest + 1,
      };
    }
    if (event.type === "creationFailed") {
      return {
        ...scope,
        tabs: scope.tabs.map((tab) => {
          if (tab.tabId !== event.tabId || tab.requestState === "ready") return tab;
          return { ...tab, requestState: event.requestState, error: event.error };
        }),
      };
    }
    if (event.type === "creationCompleted") {
      return {
        ...scope,
        tabs: scope.tabs.map((tab) =>
          tab.tabId === event.tabId ? toHostTab(event.summary, tab) : tab,
        ),
        activeTabId: event.tabId,
      };
    }
    if (event.type === "visibilitySet") {
      return { ...scope, visibility: { value: event.value, isExplicit: event.isExplicit } };
    }
    if (event.type === "focusRequested") {
      return { ...scope, focusRequest: scope.focusRequest + 1 };
    }
    if (event.type === "tabSelected") return { ...scope, activeTabId: event.tabId };
    if (event.type === "tabReordered") {
      const draggedIndex = scope.tabs.findIndex((tab) => tab.tabId === event.draggedTabId);
      const targetIndex = scope.tabs.findIndex((tab) => tab.tabId === event.targetTabId);
      if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return scope;
      const insertionIndex = event.position === "before" ? targetIndex : targetIndex + 1;
      const adjustedIndex = draggedIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
      return { ...scope, tabs: arrayMove(scope.tabs, draggedIndex, adjustedIndex) };
    }
    if (event.type === "closeStarted") {
      const closingTabIds = scope.closingTabIds.includes(event.tabId)
        ? scope.closingTabIds
        : [...scope.closingTabIds, event.tabId];
      const closingTabIdSet = new Set(closingTabIds);
      const selectableTabs = scope.tabs.filter((tab) => !closingTabIdSet.has(tab.tabId));
      return {
        ...scope,
        closingTabIds,
        activeTabId: resolveActiveTabId(selectableTabs, scope.activeTabId),
        visibility:
          selectableTabs.length === 0 ? { value: false, isExplicit: true } : scope.visibility,
      };
    }
    if (event.type === "closeRejected") {
      const closingTabIds = scope.closingTabIds.filter((tabId) => tabId !== event.tabId);
      const closingTabIdSet = new Set(closingTabIds);
      const selectableTabs = scope.tabs.filter((tab) => !closingTabIdSet.has(tab.tabId));
      return {
        ...scope,
        closingTabIds,
        activeTabId: event.tabId,
        visibility:
          selectableTabs.length > 0 ? { value: true, isExplicit: true } : scope.visibility,
      };
    }
    if (event.type === "closeCompleted") {
      const tabs = scope.tabs.filter((tab) => tab.tabId !== event.tabId);
      const closingTabIds = scope.closingTabIds.filter((tabId) => tabId !== event.tabId);
      const closingTabIdSet = new Set(closingTabIds);
      const selectableTabs = tabs.filter((tab) => !closingTabIdSet.has(tab.tabId));
      return {
        ...scope,
        tabs,
        closingTabIds,
        activeTabId: resolveActiveTabId(selectableTabs, scope.activeTabId),
        visibility:
          selectableTabs.length === 0 ? { value: false, isExplicit: true } : scope.visibility,
      };
    }
    if (event.type === "titleChanged") {
      return {
        ...scope,
        tabs: scope.tabs.map((tab) =>
          tab.terminalId === event.terminalId && tab.requestState === "ready"
            ? { ...tab, summary: { ...tab.summary, label: event.title } }
            : tab,
        ),
      };
    }
    if (event.type === "lifecycleChanged") {
      return {
        ...scope,
        tabs: scope.tabs.map((tab) =>
          tab.terminalId === event.terminalId && tab.requestState === "ready"
            ? {
                ...tab,
                summary: { ...tab.summary, lifecycle: event.lifecycle },
                awaitingLifecycleSync: true,
              }
            : tab,
        ),
      };
    }
    const forgottenTab = scope.tabs.find((tab) => tab.terminalId === event.terminalId);
    if (!forgottenTab) return scope;
    if (scope.closingTabIds.includes(forgottenTab.tabId)) return scope;
    return {
      ...scope,
      tabs: scope.tabs.map((tab) =>
        tab.terminalId === event.terminalId && tab.requestState === "ready"
          ? toLostTab(tab, event.message)
          : tab,
      ),
    };
  });
};
