import { arrayMove } from "@dnd-kit/sortable";
import type {
  TerminalCloseResponse,
  TerminalLifecycle,
  TerminalSummary,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getShellBridge } from "@/lib/shell-bridge";
import { host } from "@/state/operations/host";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { terminalListQueryOptions, terminalQueryKeys } from "@/state/queries/terminals";
import { isTerminalToggleShortcut, toggleTerminalPanel } from "./terminal-panel-policy";
import {
  createTerminalTransportController,
  type TerminalTransportController,
} from "./terminal-transport-controller";

type AgentStudioTerminalDependencies = {
  hostClient: Pick<
    typeof host,
    "taskWorktreeGet" | "terminalClose" | "terminalCreate" | "terminalList"
  >;
  terminalBridge: ReturnType<typeof getShellBridge>["terminals"];
};

const defaultDependencies = (): AgentStudioTerminalDependencies => ({
  hostClient: host,
  terminalBridge: getShellBridge().terminals,
});

export type AgentStudioTerminalTab = {
  tabId: string;
  terminalId: string | null;
  summary: TerminalSummary | null;
  lifecycle: TerminalLifecycle | null;
  lifecycleFromEvent: boolean;
  label: string;
  error: string | null;
  requestState: "ready" | "creating" | "creation_failed" | "unsupported_runtime" | "lost";
};

export type AgentStudioTerminalPanelModel = {
  scopeKey: string | null;
  taskId: string | null;
  tabs: AgentStudioTerminalTab[];
  mountedTabs: AgentStudioTerminalTab[];
  activeTabId: string | null;
  isVisible: boolean;
  isLoading: boolean;
  isCreating: boolean;
  runningCount: number;
  transportError: string | null;
  focusRequest: number;
  controller: TerminalTransportController | null;
  onToggle: () => void;
  onBackToChat: () => void;
  onSelectTab: (tabId: string) => void;
  onCreate: () => void;
  onRetryCreate: (tabId: string) => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, position: "before" | "after") => void;
  onTitleChange: (terminalId: string, title: string) => void;
  onClose: (
    tab: AgentStudioTerminalTab,
    confirmTerminate: boolean,
  ) => Promise<TerminalCloseResponse>;
  onLifecycle: (terminalId: string, lifecycle: TerminalLifecycle) => void;
  onForgotten: (terminalId: string, message: string) => void;
};

type ScopeState = {
  scopeKey: string | null;
  tabs: AgentStudioTerminalTab[];
  closingTabIds: string[];
  activeTabId: string | null;
};

type VisibilityState = {
  scopeKey: string | null;
  value: boolean;
  isExplicit: boolean;
};

const legacyPreferenceKey = (repoPath: string, taskId: string): string =>
  `openducktor:agent-studio-terminals:${repoPath}:${taskId}`;

const toHostTab = (
  summary: TerminalSummary,
  previous?: AgentStudioTerminalTab,
): AgentStudioTerminalTab => {
  const lifecycleFromEvent =
    previous?.lifecycleFromEvent === true && previous.lifecycle !== summary.lifecycle;
  return {
    tabId: previous?.tabId ?? `tab:${summary.terminalId}`,
    terminalId: summary.terminalId,
    summary,
    lifecycle: lifecycleFromEvent ? previous.lifecycle : summary.lifecycle,
    lifecycleFromEvent,
    label: previous?.label ?? summary.label,
    error: null,
    requestState: "ready",
  };
};

const resolveActiveTabId = (
  tabs: AgentStudioTerminalTab[],
  currentActiveTabId: string | null,
  preferredActiveTabId: string | null,
): string | null => {
  if (tabs.some((tab) => tab.tabId === currentActiveTabId)) return currentActiveTabId;
  if (tabs.some((tab) => tab.tabId === preferredActiveTabId)) return preferredActiveTabId;
  return tabs[0]?.tabId ?? null;
};

const beginTerminalCreation = (
  tabs: AgentStudioTerminalTab[],
  tabId: string,
  retry: boolean,
  label: string,
): AgentStudioTerminalTab[] => {
  if (retry) {
    return tabs.map((tab) =>
      tab.tabId === tabId ? { ...tab, requestState: "creating", error: null } : tab,
    );
  }
  return [
    ...tabs,
    {
      tabId,
      terminalId: null,
      summary: null,
      lifecycle: null,
      lifecycleFromEvent: false,
      label,
      error: null,
      requestState: "creating",
    },
  ];
};

export const useAgentStudioTerminals = (
  {
    repoPath,
    taskId,
    taskVersion,
  }: {
    repoPath: string | null;
    taskId: string | null;
    taskVersion?: string | null;
  },
  dependencies = defaultDependencies(),
): AgentStudioTerminalPanelModel => {
  const scopeKey = repoPath && taskId ? `${repoPath}:${taskId}` : null;
  const queryClient = useQueryClient();
  const [scopeState, setScopeState] = useState<ScopeState>({
    scopeKey,
    tabs: [],
    closingTabIds: [],
    activeTabId: null,
  });
  const [visibility, setVisibility] = useState<VisibilityState>({
    scopeKey,
    value: false,
    isExplicit: false,
  });
  const [transportError, setTransportError] = useState<string | null>(null);
  const handleTransportState = useCallback((state: "connected" | "disconnected"): void => {
    if (state === "connected") setTransportError(null);
  }, []);
  const handleProtocolFailure = useCallback((failure: { message: string }): void => {
    setTransportError(failure.message);
  }, []);
  const [focusState, setFocusState] = useState({ scopeKey, request: 0 });
  const controllerRef = useRef<{ scopeKey: string; value: TerminalTransportController } | null>(
    null,
  );
  const enabled = repoPath !== null && taskId !== null;
  const terminalOptions = enabled
    ? terminalListQueryOptions({ repoPath, taskId, hostClient: dependencies.hostClient })
    : terminalListQueryOptions({
        repoPath: "disabled",
        taskId: "disabled",
        hostClient: dependencies.hostClient,
      });
  const worktreeOptions = enabled
    ? taskWorktreeQueryOptions({
        repoPath,
        taskId,
        hostClient: dependencies.hostClient,
        ...(taskVersion !== undefined ? { taskVersion } : {}),
      })
    : taskWorktreeQueryOptions({
        repoPath: "disabled",
        taskId: "disabled",
        hostClient: dependencies.hostClient,
      });
  const terminalQuery = useQuery({
    ...terminalOptions,
    enabled,
  });
  const worktreeQuery = useQuery({
    ...worktreeOptions,
    enabled,
  });

  useLayoutEffect(() => {
    if (repoPath && taskId) localStorage.removeItem(legacyPreferenceKey(repoPath, taskId));
    setScopeState({
      scopeKey,
      tabs: [],
      closingTabIds: [],
      activeTabId: null,
    });
    setVisibility({ scopeKey, value: false, isExplicit: false });
    setFocusState({ scopeKey, request: 0 });
    setTransportError(null);
  }, [repoPath, scopeKey, taskId]);

  useEffect(() => {
    controllerRef.current?.value.dispose();
    controllerRef.current = null;
    if (!scopeKey) return;
    const controller = createTerminalTransportController(
      dependencies.terminalBridge,
      handleTransportState,
      handleProtocolFailure,
    );
    controllerRef.current = { scopeKey, value: controller };
    void controller.connect().catch(() => handleTransportState("disconnected"));
    return () => controller.dispose();
  }, [dependencies.terminalBridge, handleProtocolFailure, handleTransportState, scopeKey]);

  useEffect(() => {
    if (!scopeKey || !terminalQuery.data) return;
    setScopeState((current) => {
      if (current.scopeKey !== scopeKey) return current;
      const transient = current.tabs.filter((tab) => tab.terminalId === null);
      const currentTabsByTerminalId = new Map(
        current.tabs.flatMap((tab) => (tab.terminalId ? [[tab.terminalId, tab] as const] : [])),
      );
      const summariesByTerminalId = new Map(
        terminalQuery.data.terminals.map((summary) => [summary.terminalId, summary] as const),
      );
      const hostTabs = current.tabs.flatMap((tab) => {
        if (!tab.terminalId) return [];
        const summary = summariesByTerminalId.get(tab.terminalId);
        return summary ? [toHostTab(summary, tab)] : [];
      });
      const knownTerminalIds = new Set(hostTabs.map((tab) => tab.terminalId));
      for (const summary of terminalQuery.data.terminals) {
        if (!knownTerminalIds.has(summary.terminalId)) {
          hostTabs.push(toHostTab(summary, currentTabsByTerminalId.get(summary.terminalId)));
        }
      }
      const tabs = [...hostTabs, ...transient];
      const closingTabIdSet = new Set(current.closingTabIds);
      const selectableTabs = tabs.filter((tab) => !closingTabIdSet.has(tab.tabId));
      return {
        scopeKey,
        tabs,
        closingTabIds: current.closingTabIds,
        activeTabId: resolveActiveTabId(selectableTabs, current.activeTabId, null),
      };
    });
  }, [scopeKey, terminalQuery.data]);

  const visibleState =
    scopeState.scopeKey === scopeKey
      ? scopeState
      : { scopeKey, tabs: [], closingTabIds: [], activeTabId: null };
  const visibleTabs = useMemo(() => {
    const closingTabIdSet = new Set(visibleState.closingTabIds);
    return visibleState.tabs.filter((tab) => !closingTabIdSet.has(tab.tabId));
  }, [visibleState.closingTabIds, visibleState.tabs]);
  const isVisible =
    visibility.scopeKey === scopeKey &&
    (visibility.isExplicit ? visibility.value : visibleTabs.length > 0);
  const focusRequest = focusState.scopeKey === scopeKey ? focusState.request : 0;

  const createTerminal = useCallback(
    async (retryTabId?: string): Promise<void> => {
      if (!repoPath || !taskId) return;
      const tabId = retryTabId ?? `creating:${globalThis.crypto.randomUUID()}`;
      const workingDir = worktreeQuery.data?.workingDirectory;
      setScopeState((current) => ({
        ...current,
        tabs: beginTerminalCreation(
          current.tabs,
          tabId,
          retryTabId !== undefined,
          workingDir ?? repoPath,
        ),
        activeTabId: tabId,
      }));
      if (!workingDir) {
        setScopeState((current) => ({
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.tabId === tabId
              ? {
                  ...tab,
                  requestState: "creation_failed",
                  error: `Task ${taskId} has no available worktree.`,
                }
              : tab,
          ),
        }));
        return;
      }
      try {
        const created = await dependencies.hostClient.terminalCreate({
          workingDir,
          context: { taskId },
        });
        setScopeState((current) => ({
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.tabId === tabId ? toHostTab(created.summary, tab) : tab,
          ),
          activeTabId: tabId,
        }));
        await queryClient.invalidateQueries({
          queryKey: terminalQueryKeys.task({ repoPath, taskId }),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const requestState: AgentStudioTerminalTab["requestState"] = message.includes(
          "unsupported_runtime",
        )
          ? "unsupported_runtime"
          : "creation_failed";
        setScopeState((current) => ({
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.tabId === tabId
              ? {
                  ...tab,
                  requestState,
                  error: message,
                }
              : tab,
          ),
        }));
      }
    },
    [dependencies.hostClient, queryClient, repoPath, taskId, worktreeQuery.data?.workingDirectory],
  );

  const togglePanel = useCallback((): void => {
    const transition = toggleTerminalPanel(isVisible);
    setVisibility({ scopeKey, value: transition.visible, isExplicit: true });
    if (transition.requestFocus) {
      setFocusState((current) => ({
        scopeKey,
        request: current.scopeKey === scopeKey ? current.request + 1 : 1,
      }));
      if (visibleState.tabs.length === 0 && !terminalQuery.isLoading && !worktreeQuery.isLoading) {
        void createTerminal();
      }
    }
  }, [
    createTerminal,
    scopeKey,
    terminalQuery.isLoading,
    isVisible,
    visibleState.tabs.length,
    worktreeQuery.isLoading,
  ]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (isTerminalToggleShortcut(event)) {
        event.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [togglePanel]);

  return useMemo(
    () => ({
      scopeKey,
      taskId,
      tabs: visibleTabs,
      mountedTabs: visibleState.tabs,
      activeTabId: visibleState.activeTabId,
      isVisible,
      isLoading: terminalQuery.isLoading || worktreeQuery.isLoading,
      isCreating: visibleTabs.some((tab) => tab.requestState === "creating"),
      runningCount: visibleTabs.filter((tab) => tab.lifecycle === "running").length,
      transportError,
      focusRequest,
      controller: controllerRef.current?.scopeKey === scopeKey ? controllerRef.current.value : null,
      onToggle: togglePanel,
      onBackToChat: () => setVisibility({ scopeKey, value: false, isExplicit: true }),
      onSelectTab: (activeTabId: string) =>
        setScopeState((current) => ({ ...current, activeTabId })),
      onCreate: () => void createTerminal(),
      onRetryCreate: (tabId: string) => void createTerminal(tabId),
      onReorderTab: (draggedTabId: string, targetTabId: string, position: "before" | "after") =>
        setScopeState((current) => {
          const draggedIndex = current.tabs.findIndex((tab) => tab.tabId === draggedTabId);
          const targetIndex = current.tabs.findIndex((tab) => tab.tabId === targetTabId);
          if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return current;
          const insertionIndex = position === "before" ? targetIndex : targetIndex + 1;
          const adjustedIndex = draggedIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
          return { ...current, tabs: arrayMove(current.tabs, draggedIndex, adjustedIndex) };
        }),
      onTitleChange: (terminalId: string, title: string) =>
        setScopeState((current) => ({
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.terminalId === terminalId ? { ...tab, label: title } : tab,
          ),
        })),
      onClose: async (tab: AgentStudioTerminalTab, confirmTerminate: boolean) => {
        const closesLastTab = visibleTabs.length === 1 && visibleTabs[0]?.tabId === tab.tabId;
        const removeMountedTab = (): void => {
          setScopeState((current) => {
            if (current.scopeKey !== scopeKey) return current;
            const tabs = current.tabs.filter((candidate) => candidate.tabId !== tab.tabId);
            const closingTabIds = current.closingTabIds.filter((tabId) => tabId !== tab.tabId);
            const closingTabIdSet = new Set(closingTabIds);
            const selectableTabs = tabs.filter(
              (candidate) => !closingTabIdSet.has(candidate.tabId),
            );
            return {
              ...current,
              tabs,
              closingTabIds,
              activeTabId: resolveActiveTabId(selectableTabs, current.activeTabId, null),
            };
          });
          if (closesLastTab)
            setVisibility((current) =>
              current.scopeKey === scopeKey
                ? { scopeKey, value: false, isExplicit: true }
                : current,
            );
        };
        const hideClosingTab = (): void => {
          setScopeState((current) => {
            if (current.scopeKey !== scopeKey) return current;
            const closingTabIds = [...current.closingTabIds, tab.tabId];
            const closingTabIdSet = new Set(closingTabIds);
            const tabs = current.tabs.filter((candidate) => !closingTabIdSet.has(candidate.tabId));
            return {
              ...current,
              closingTabIds,
              activeTabId: resolveActiveTabId(tabs, current.activeTabId, null),
            };
          });
          if (closesLastTab)
            setVisibility((current) =>
              current.scopeKey === scopeKey
                ? { scopeKey, value: false, isExplicit: true }
                : current,
            );
        };
        const restoreClosingTab = (): void => {
          setScopeState((current) => {
            if (current.scopeKey !== scopeKey) return current;
            return {
              ...current,
              closingTabIds: current.closingTabIds.filter((tabId) => tabId !== tab.tabId),
              activeTabId: tab.tabId,
            };
          });
          if (closesLastTab)
            setVisibility((current) =>
              current.scopeKey === scopeKey ? { scopeKey, value: true, isExplicit: true } : current,
            );
        };
        if (!tab.terminalId) {
          removeMountedTab();
          return { closed: true };
        }
        const terminalId = tab.terminalId;
        const controller = controllerRef.current;
        if (!controller || controller.scopeKey !== scopeKey) {
          throw new Error("Terminal transport is unavailable for this task.");
        }
        hideClosingTab();
        let closeResult: TerminalCloseResponse;
        try {
          closeResult = await controller.value.closeTerminal(terminalId, () =>
            dependencies.hostClient.terminalClose({
              terminalId,
              confirmTerminate,
            }),
          );
        } catch (cause) {
          restoreClosingTab();
          throw cause;
        }
        if (!closeResult.closed) {
          restoreClosingTab();
          return closeResult;
        }
        removeMountedTab();
        if (repoPath && taskId)
          await queryClient.invalidateQueries({
            queryKey: terminalQueryKeys.task({ repoPath, taskId }),
          });
        return closeResult;
      },
      onLifecycle: (terminalId: string, lifecycle: TerminalLifecycle) =>
        setScopeState((current) => ({
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.terminalId === terminalId ? { ...tab, lifecycle, lifecycleFromEvent: true } : tab,
          ),
        })),
      onForgotten: (terminalId: string, message: string) => {
        setScopeState((current) => {
          const forgottenTab = current.tabs.find((tab) => tab.terminalId === terminalId);
          if (!forgottenTab) return current;
          const lostTabId = `lost:${terminalId}`;
          return {
            ...current,
            tabs: current.tabs.map((tab) =>
              tab.terminalId === terminalId
                ? {
                    ...tab,
                    tabId: lostTabId,
                    terminalId: null,
                    summary: null,
                    lifecycle: null,
                    lifecycleFromEvent: false,
                    error: `${message} It cannot be recovered or recreated automatically.`,
                    requestState: "lost",
                  }
                : tab,
            ),
            activeTabId:
              current.activeTabId === forgottenTab.tabId ? lostTabId : current.activeTabId,
          };
        });
      },
    }),
    [
      createTerminal,
      dependencies.hostClient,
      focusRequest,
      isVisible,
      queryClient,
      repoPath,
      scopeKey,
      taskId,
      terminalQuery.isLoading,
      transportError,
      togglePanel,
      visibleState.activeTabId,
      visibleState.tabs,
      visibleTabs,
      worktreeQuery.isLoading,
    ],
  );
};
