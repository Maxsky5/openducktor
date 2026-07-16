import type { TerminalCloseResponse, TerminalLifecycle } from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer } from "react";
import { getShellBridge } from "@/lib/shell-bridge";
import { host } from "@/state/operations/host";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { terminalListQueryOptions, terminalQueryKeys } from "@/state/queries/terminals";
import { isTerminalToggleShortcut, toggleTerminalPanel } from "./terminal-panel-policy";
import {
  type AgentStudioTerminalTab,
  createTerminalPresentationState,
  emptyTerminalScopePresentation,
  terminalPresentationReducer,
} from "./terminal-presentation-state";
import type { TerminalTransportController } from "./terminal-transport-controller";
import { useTerminalTransport } from "./use-terminal-transport";

export type { AgentStudioTerminalTab } from "./terminal-presentation-state";

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

const legacyPreferenceKey = (repoPath: string, taskId: string): string =>
  `openducktor:agent-studio-terminals:${repoPath}:${taskId}`;

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
  const [presentation, dispatch] = useReducer(
    terminalPresentationReducer,
    scopeKey,
    createTerminalPresentationState,
  );
  const { controller, transportError } = useTerminalTransport(
    scopeKey,
    dependencies.terminalBridge,
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
    dispatch({ type: "scopeActivated", scopeKey });
  }, [repoPath, scopeKey, taskId]);

  useEffect(() => {
    if (!scopeKey || !terminalQuery.data) return;
    dispatch({ type: "hostSynced", scopeKey, summaries: terminalQuery.data.terminals });
  }, [scopeKey, terminalQuery.data]);

  const visibleState = useMemo(() => {
    if (!scopeKey || presentation.activeScopeKey !== scopeKey)
      return emptyTerminalScopePresentation();
    return presentation.scopes[scopeKey] ?? emptyTerminalScopePresentation();
  }, [presentation, scopeKey]);
  const visibleTabs = useMemo(() => {
    const closingTabIdSet = new Set(visibleState.closingTabIds);
    return visibleState.tabs.filter((tab) => !closingTabIdSet.has(tab.tabId));
  }, [visibleState.closingTabIds, visibleState.tabs]);
  const isVisible = visibleState.visibility.isExplicit
    ? visibleState.visibility.value
    : visibleTabs.length > 0;
  const focusRequest = visibleState.focusRequest;

  const createTerminal = useCallback(
    async (retryTabId?: string): Promise<void> => {
      if (!repoPath || !taskId || !scopeKey) return;
      const tabId = retryTabId ?? `creating:${globalThis.crypto.randomUUID()}`;
      const workingDir = worktreeQuery.data?.workingDirectory;
      dispatch({
        type: "creationStarted",
        scopeKey,
        tabId,
        retry: retryTabId !== undefined,
        label: workingDir ?? repoPath,
      });
      if (!workingDir) {
        dispatch({
          type: "creationFailed",
          scopeKey,
          tabId,
          requestState: "creation_failed",
          error: `Task ${taskId} has no available worktree.`,
        });
        return;
      }
      try {
        const created = await dependencies.hostClient.terminalCreate({
          workingDir,
          context: { taskId },
        });
        dispatch({ type: "creationCompleted", scopeKey, tabId, summary: created.summary });
        await queryClient.invalidateQueries({
          queryKey: terminalQueryKeys.task({ repoPath, taskId }),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const requestState =
          cause instanceof HostTerminalClientError && cause.code === "unsupported_runtime"
            ? "unsupported_runtime"
            : "creation_failed";
        dispatch({ type: "creationFailed", scopeKey, tabId, requestState, error: message });
      }
    },
    [
      dependencies.hostClient,
      queryClient,
      repoPath,
      scopeKey,
      taskId,
      worktreeQuery.data?.workingDirectory,
    ],
  );

  const togglePanel = useCallback((): void => {
    if (!scopeKey) return;
    const transition = toggleTerminalPanel(isVisible);
    dispatch({ type: "visibilitySet", scopeKey, value: transition.visible, isExplicit: true });
    if (transition.requestFocus) {
      dispatch({ type: "focusRequested", scopeKey });
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
      controller,
      onToggle: togglePanel,
      onBackToChat: () => {
        if (scopeKey) dispatch({ type: "visibilitySet", scopeKey, value: false, isExplicit: true });
      },
      onSelectTab: (tabId: string) => {
        if (scopeKey) dispatch({ type: "tabSelected", scopeKey, tabId });
      },
      onCreate: () => void createTerminal(),
      onRetryCreate: (tabId: string) => void createTerminal(tabId),
      onReorderTab: (draggedTabId: string, targetTabId: string, position: "before" | "after") => {
        if (scopeKey)
          dispatch({ type: "tabReordered", scopeKey, draggedTabId, targetTabId, position });
      },
      onTitleChange: (terminalId: string, title: string) => {
        if (scopeKey) dispatch({ type: "titleChanged", scopeKey, terminalId, title });
      },
      onClose: async (tab: AgentStudioTerminalTab, confirmTerminate: boolean) => {
        if (!scopeKey) throw new Error("Terminal scope is unavailable.");
        if (!tab.terminalId) {
          dispatch({ type: "closeCompleted", scopeKey, tabId: tab.tabId });
          return { closed: true };
        }
        const terminalId = tab.terminalId;
        if (!controller) {
          throw new Error("Terminal transport is unavailable for this task.");
        }
        dispatch({ type: "closeStarted", scopeKey, tabId: tab.tabId });
        let closeResult: TerminalCloseResponse;
        try {
          closeResult = await controller.closeTerminal(terminalId, () =>
            dependencies.hostClient.terminalClose({
              terminalId,
              confirmTerminate,
            }),
          );
        } catch (cause) {
          dispatch({ type: "closeRejected", scopeKey, tabId: tab.tabId });
          throw cause;
        }
        if (!closeResult.closed) {
          dispatch({ type: "closeRejected", scopeKey, tabId: tab.tabId });
          return closeResult;
        }
        dispatch({ type: "closeCompleted", scopeKey, tabId: tab.tabId });
        if (repoPath && taskId)
          await queryClient.invalidateQueries({
            queryKey: terminalQueryKeys.task({ repoPath, taskId }),
          });
        return closeResult;
      },
      onLifecycle: (terminalId: string, lifecycle: TerminalLifecycle) => {
        if (scopeKey) dispatch({ type: "lifecycleChanged", scopeKey, terminalId, lifecycle });
      },
      onForgotten: (terminalId: string, message: string) => {
        if (scopeKey) dispatch({ type: "terminalForgotten", scopeKey, terminalId, message });
      },
    }),
    [
      createTerminal,
      controller,
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
