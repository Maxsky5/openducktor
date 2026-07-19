import type {
  AppPlatform,
  TerminalCloseResponse,
  TerminalContext,
  TerminalLifecycle,
  TerminalListFilter,
} from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { getShellBridge } from "@/lib/shell-bridge";
import { host } from "@/state/operations/host";
import { platformQueryOptions } from "@/state/queries/system";
import { terminalListByFilterQueryOptions, terminalQueryKeys } from "@/state/queries/terminals";
import { isTerminalToggleShortcut, toggleTerminalPanel } from "./terminal-panel-policy";
import {
  createTerminalPresentationState,
  emptyTerminalScopePresentation,
  type TerminalTab,
  terminalPresentationReducer,
} from "./terminal-presentation-state";
import type { TerminalTransportController } from "./terminal-transport-controller";
import { useTerminalTransport } from "./use-terminal-transport";

export type { TerminalTab } from "./terminal-presentation-state";

export type TerminalDependencies = {
  hostClient: Pick<
    typeof host,
    "systemGetPlatform" | "terminalClose" | "terminalCreate" | "terminalList"
  >;
  terminalBridge: ReturnType<typeof getShellBridge>["terminals"];
};

const defaultDependencies = (): TerminalDependencies => ({
  hostClient: host,
  terminalBridge: getShellBridge().terminals,
});

export type TerminalScope = {
  key: string;
  context: TerminalContext;
  workingDirectory: string | null;
  workingDirectoryError: string;
};

const terminalListFilterForContext = (context: TerminalContext | null): TerminalListFilter => {
  if (context === null) return { kind: "all" };
  if ("taskId" in context) {
    return { kind: "task", repoPath: context.repoPath, taskId: context.taskId };
  }
  return { kind: "unassociated" };
};

export type TerminalPanelModel = {
  scopeKey: string | null;
  isAvailable: boolean;
  tabs: TerminalTab[];
  mountedTabs: TerminalTab[];
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
  onHide: () => void;
  onSelectTab: (tabId: string) => void;
  onCreate: () => void;
  onRetryCreate: (tabId: string) => void;
  onReorderTab: (draggedTabId: string, targetTabId: string, position: "before" | "after") => void;
  onTitleChange: (terminalId: string, title: string) => void;
  onClose: (tab: TerminalTab, confirmTerminate: boolean) => Promise<TerminalCloseResponse>;
  onLifecycle: (terminalId: string, lifecycle: TerminalLifecycle) => void;
  onForgotten: (terminalId: string, message: string) => void;
};

export const useTerminals = (
  {
    scope,
    isScopeLoading = false,
  }: {
    scope: TerminalScope | null;
    isScopeLoading?: boolean;
  },
  dependencies = defaultDependencies(),
): TerminalPanelModel => {
  const scopeKey = scope?.key ?? null;
  const queryClient = useQueryClient();
  const [presentation, dispatch] = useReducer(
    terminalPresentationReducer,
    scopeKey,
    createTerminalPresentationState,
  );
  const abandonedCreationTabIds = useRef(new Set<string>());
  const { controller, transportError } = useTerminalTransport(dependencies.terminalBridge);
  const enabled = scope !== null;
  const listFilter = useMemo(
    () => terminalListFilterForContext(scope?.context ?? null),
    [scope?.context],
  );
  const terminalOptions = terminalListByFilterQueryOptions({
    filter: listFilter,
    hostClient: dependencies.hostClient,
  });
  const terminalQuery = useQuery({
    ...terminalOptions,
    enabled,
  });
  const platformQuery = useQuery(platformQueryOptions(dependencies.hostClient));

  useLayoutEffect(() => {
    dispatch({ type: "scopeActivated", scopeKey });
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey || !terminalQuery.data) return;
    dispatch({
      type: "hostSynced",
      scopeKey,
      hostInstanceId: terminalQuery.data.hostInstanceId,
      summaries: terminalQuery.data.terminals,
    });
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
      if (!scope || !scopeKey) return;
      const tabId = retryTabId ?? `creating:${globalThis.crypto.randomUUID()}`;
      const workingDir = scope.workingDirectory;
      dispatch({
        type: "creationStarted",
        scopeKey,
        tabId,
        retry: retryTabId !== undefined,
        label: workingDir ?? "Terminal",
      });
      if (!workingDir) {
        dispatch({
          type: "creationFailed",
          scopeKey,
          tabId,
          requestState: "creation_failed",
          error: scope.workingDirectoryError,
        });
        return;
      }
      try {
        const created = await dependencies.hostClient.terminalCreate({
          workingDir,
          context: scope.context,
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
              queryKey: terminalQueryKeys.filter(listFilter),
            });
          }
          return;
        }
        dispatch({ type: "creationCompleted", scopeKey, tabId, summary: created.summary });
        await queryClient.invalidateQueries({
          queryKey: terminalQueryKeys.filter(listFilter),
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
    [dependencies.hostClient, listFilter, queryClient, scope, scopeKey],
  );

  const togglePanel = useCallback((): void => {
    if (!scopeKey) return;
    const transition = toggleTerminalPanel(isVisible);
    dispatch({ type: "visibilitySet", scopeKey, value: transition.visible, isExplicit: true });
    if (transition.requestFocus) {
      dispatch({ type: "focusRequested", scopeKey });
      if (visibleState.tabs.length === 0 && !terminalQuery.isLoading && !isScopeLoading) {
        void createTerminal();
      }
    }
  }, [
    createTerminal,
    isScopeLoading,
    scopeKey,
    terminalQuery.isLoading,
    isVisible,
    visibleState.tabs.length,
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

  const hidePanel = useCallback((): void => {
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
    async (tab: TerminalTab, confirmTerminate: boolean): Promise<TerminalCloseResponse> => {
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
        throw new Error("Terminal transport is unavailable.");
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
      if (scope)
        await queryClient.invalidateQueries({
          queryKey: terminalQueryKeys.filter(listFilter),
        });
      return closeResult;
    },
    [controller, dependencies.hostClient, listFilter, queryClient, scope, scopeKey],
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
  const isLoading = terminalQuery.isLoading || isScopeLoading;
  const isCreating = visibleTabs.some((tab) => tab.requestState === "creating");

  return useMemo(
    () => ({
      scopeKey,
      isAvailable: scope !== null,
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
      onHide: hidePanel,
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
      changeLifecycle,
      changeTitle,
      closeTerminal,
      controller,
      focusRequest,
      forgetTerminal,
      hidePanel,
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
      scope,
      scopeKey,
      startCreate,
      transportError,
      togglePanel,
      visibleState.activeTabId,
      visibleTabs,
    ],
  );
};
