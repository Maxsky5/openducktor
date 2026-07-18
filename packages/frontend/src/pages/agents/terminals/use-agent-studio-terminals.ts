import type { AppPlatform, TerminalCloseResponse, TerminalLifecycle } from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { getShellBridge } from "@/lib/shell-bridge";
import { host } from "@/state/operations/host";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { platformQueryOptions } from "@/state/queries/system";
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
    "systemGetPlatform" | "taskWorktreeGet" | "terminalClose" | "terminalCreate" | "terminalList"
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
  transportError: string | null;
  platform: AppPlatform | undefined;
  platformError: string | null;
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
  const abandonedCreationTabIds = useRef(new Set<string>());
  const { controller, transportError } = useTerminalTransport(dependencies.terminalBridge);
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
  const platformQuery = useQuery(platformQueryOptions(dependencies.hostClient));

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
  const mountedTabs = useMemo(
    () =>
      visibleState.tabs.toSorted((left, right) => {
        const leftCreatedAt = left.summary?.createdAt ?? `~${left.tabId}`;
        const rightCreatedAt = right.summary?.createdAt ?? `~${right.tabId}`;
        return leftCreatedAt.localeCompare(rightCreatedAt);
      }),
    [visibleState.tabs],
  );
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
          context: { repoPath, taskId },
        });
        if (abandonedCreationTabIds.current.delete(tabId)) {
          dispatch({ type: "creationCompleted", scopeKey, tabId, summary: created.summary });
          let closed = false;
          try {
            const closeResult = await dependencies.hostClient.terminalClose({
              terminalId: created.ref.terminalId,
              confirmTerminate: true,
            });
            closed = closeResult.closed;
          } finally {
            dispatch({ type: closed ? "closeCompleted" : "closeRejected", scopeKey, tabId });
            await queryClient.invalidateQueries({
              queryKey: terminalQueryKeys.task({ repoPath, taskId }),
            });
          }
          return;
        }
        dispatch({ type: "creationCompleted", scopeKey, tabId, summary: created.summary });
        await queryClient.invalidateQueries({
          queryKey: terminalQueryKeys.task({ repoPath, taskId }),
        });
      } catch (cause) {
        if (abandonedCreationTabIds.current.delete(tabId)) {
          dispatch({ type: "closeCompleted", scopeKey, tabId });
          return;
        }
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

  const backToChat = useCallback((): void => {
    if (scopeKey) dispatch({ type: "visibilitySet", scopeKey, value: false, isExplicit: true });
  }, [scopeKey]);
  const selectTab = useCallback(
    (tabId: string): void => {
      if (!scopeKey) return;
      dispatch({ type: "tabSelected", scopeKey, tabId });
      dispatch({ type: "focusRequested", scopeKey });
    },
    [scopeKey],
  );
  const startCreate = useCallback((): void => void createTerminal(), [createTerminal]);
  const retryCreate = useCallback(
    (tabId: string): void => void createTerminal(tabId),
    [createTerminal],
  );
  const reorderTab = useCallback(
    (draggedTabId: string, targetTabId: string, position: "before" | "after"): void => {
      if (scopeKey)
        dispatch({ type: "tabReordered", scopeKey, draggedTabId, targetTabId, position });
    },
    [scopeKey],
  );
  const changeTitle = useCallback(
    (terminalId: string, title: string): void => {
      if (scopeKey) dispatch({ type: "titleChanged", scopeKey, terminalId, title });
    },
    [scopeKey],
  );
  const closeTerminal = useCallback(
    async (
      tab: AgentStudioTerminalTab,
      confirmTerminate: boolean,
    ): Promise<TerminalCloseResponse> => {
      if (!scopeKey) throw new Error("Terminal scope is unavailable.");
      if (!tab.terminalId) {
        if (tab.requestState === "creating") {
          abandonedCreationTabIds.current.add(tab.tabId);
          dispatch({ type: "closeStarted", scopeKey, tabId: tab.tabId });
        } else {
          dispatch({ type: "closeCompleted", scopeKey, tabId: tab.tabId });
        }
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
    [controller, dependencies.hostClient, queryClient, repoPath, scopeKey, taskId],
  );
  const changeLifecycle = useCallback(
    (terminalId: string, lifecycle: TerminalLifecycle): void => {
      if (scopeKey) dispatch({ type: "lifecycleChanged", scopeKey, terminalId, lifecycle });
    },
    [scopeKey],
  );
  const forgetTerminal = useCallback(
    (terminalId: string, message: string): void => {
      if (scopeKey) dispatch({ type: "terminalForgotten", scopeKey, terminalId, message });
    },
    [scopeKey],
  );
  const isLoading = terminalQuery.isLoading || worktreeQuery.isLoading;
  const isCreating = visibleTabs.some((tab) => tab.requestState === "creating");

  return useMemo(
    () => ({
      scopeKey,
      taskId,
      tabs: visibleTabs,
      mountedTabs,
      activeTabId: visibleState.activeTabId,
      isVisible,
      isLoading,
      isCreating,
      transportError,
      platform: platformQuery.data,
      platformError: platformQuery.isError ? platformQuery.error.message : null,
      focusRequest,
      controller,
      onToggle: togglePanel,
      onBackToChat: backToChat,
      onSelectTab: selectTab,
      onCreate: startCreate,
      onRetryCreate: retryCreate,
      onReorderTab: reorderTab,
      onTitleChange: changeTitle,
      onClose: closeTerminal,
      onLifecycle: changeLifecycle,
      onForgotten: forgetTerminal,
    }),
    [
      backToChat,
      changeLifecycle,
      changeTitle,
      closeTerminal,
      controller,
      focusRequest,
      forgetTerminal,
      isCreating,
      isLoading,
      isVisible,
      mountedTabs,
      platformQuery.data,
      platformQuery.error,
      platformQuery.isError,
      reorderTab,
      retryCreate,
      selectTab,
      scopeKey,
      startCreate,
      taskId,
      transportError,
      togglePanel,
      visibleState.activeTabId,
      visibleTabs,
    ],
  );
};
