import type {
  AppPlatform,
  RepoAction,
  TerminalActivity,
  TerminalCloseResponse,
  TerminalCreateResponse,
  TerminalLifecycle,
  TerminalListFilter,
  TerminalListResponse,
  TerminalOwnedContext,
  TerminalOwnedLaunchSpec,
} from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from "react";
import { getShellBridge } from "@/lib/shell-bridge";
import { host } from "@/state/operations/host";
import { platformQueryOptions } from "@/state/queries/system";
import {
  invalidateTerminalList,
  terminalListByFilterQueryOptions,
} from "@/state/queries/terminals";
import { terminalActivityOwnerKey } from "./terminal-activity-store";
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
    "systemGetPlatform" | "terminalClose" | "terminalCreate" | "terminalList" | "terminalRunAction"
  >;
  terminalBridge: ReturnType<typeof getShellBridge>["terminals"];
};

export type TerminalScope = {
  key: string;
  context: TerminalOwnedContext;
  workingDirectory: string | null;
  workingDirectoryError: string;
};

export type TerminalSessionsModel = {
  scopeKey: string | null;
  isAvailable: boolean;
  /** Why a new terminal or action run cannot start now, or null when it can. */
  startBlockedReason: string | null;
  /** All terminal tabs of the scope, also the tabs that are closing. */
  tabs: TerminalTab[];
  closingTabIds: ReadonlySet<string>;
  /**
   * The terminals of the scope that run a command, from the live activity stream. The host asks
   * for a confirmation before it closes them.
   */
  runningCommandTerminalIds: ReadonlySet<string>;
  /** True when `tabs` include each terminal of the latest host list for the scope. */
  isSynced: boolean;
  mountedTabs: MountedTab[];
  isLoading: boolean;
  discoveryError: string | null;
  transportError: string | null;
  platform: AppPlatform | undefined;
  platformError: string | null;
  controller: TerminalTransportController | null;
  /** Starts a terminal, or runs the action in one. Returns its tab ID, or null when start is blocked. */
  createTerminal: (action?: RepoAction) => string | null;
  onRetryDiscovery: () => void;
  onRetryCreate: (scopeKey: string, tabId: string, actionId: string | null) => void;
  onTitleChange: (scopeKey: string, terminalId: string, title: string) => void;
  onClose: (tab: TerminalTab, confirmTerminate: boolean) => Promise<TerminalCloseResponse>;
  onLifecycle: (scopeKey: string, terminalId: string, lifecycle: TerminalLifecycle) => void;
  onForgotten: (scopeKey: string, terminalId: string, message: string) => void;
};

const NO_COMMANDS: readonly TerminalActivity[] = [];

/** Watches the commands that the terminals of a scope run. */
const useRunningCommandTerminalIds = (
  controller: TerminalTransportController | null,
  scope: TerminalScope | null,
): ReadonlySet<string> => {
  const activityKey = scope ? terminalActivityOwnerKey(scope.context) : null;
  const subscribe = useCallback(
    (listener: () => void): (() => void) => controller?.subscribeActivity(listener) ?? (() => {}),
    [controller],
  );
  const readCommands = useCallback(
    (): readonly TerminalActivity[] =>
      controller && activityKey !== null
        ? controller.readActivity(activityKey).commands
        : NO_COMMANDS,
    [activityKey, controller],
  );
  const commands = useSyncExternalStore(subscribe, readCommands, readCommands);
  return useMemo(() => new Set(commands.map((command) => command.summary.terminalId)), [commands]);
};

export const useTerminals = (
  {
    scope,
    isScopeLoading,
    mountedScopeKeys,
  }: {
    scope: TerminalScope | null;
    isScopeLoading: boolean;
    mountedScopeKeys: readonly string[];
  },
  dependencies = defaultDependencies(),
): TerminalSessionsModel => {
  const scopeKey = scope?.key ?? null;
  const queryClient = useQueryClient();
  const [presentation, dispatch] = useReducer(
    terminalPresentationReducer,
    scopeKey,
    createTerminalPresentationState,
  );
  const abandonedCreationTabIds = useRef(new Set<string>());
  const { controller, transportError } = useTerminalTransport(dependencies.terminalBridge);
  const runningCommandTerminalIds = useRunningCommandTerminalIds(controller, scope);
  const listFilter = useMemo(() => filterForContext(scope?.context ?? null), [scope?.context]);
  const terminalOptions = terminalListByFilterQueryOptions({
    filter: scope === null ? null : listFilter,
    hostClient: dependencies.hostClient,
  });
  const terminalQuery = useQuery<TerminalListResponse>(terminalOptions);
  const platformQuery = useQuery(platformQueryOptions(dependencies.hostClient));

  // Switch scopes during render so the next commit cannot show the old scope.
  if (presentation.activeScopeKey !== scopeKey) {
    dispatch({ type: "scopeActivated", scopeKey });
  }

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
  const closingTabIds = useMemo(
    () => new Set(visibleState.closingTabIds),
    [visibleState.closingTabIds],
  );
  const mountedTabs = useMemo(
    () =>
      mountedScopeKeys.flatMap((ownerScopeKey) =>
        (presentation.scopes[ownerScopeKey]?.tabs ?? []).map((tab) => ({
          scopeKey: ownerScopeKey,
          tab,
        })),
      ),
    [mountedScopeKeys, presentation.scopes],
  );
  const isSynced = useMemo(() => {
    const list = terminalQuery.data;
    if (!list || visibleState.hostInstanceId !== list.hostInstanceId) return false;
    const knownTerminalIds = new Set(
      visibleState.tabs.map((tab) =>
        tab.requestState === "lost" ? tab.sourceTerminalId : tab.terminalId,
      ),
    );
    return list.terminals.every((summary) => knownTerminalIds.has(summary.terminalId));
  }, [terminalQuery.data, visibleState.hostInstanceId, visibleState.tabs]);

  const startTerminal = useCallback(
    async ({ tabId, retry, actionId, label }: TerminalCreation): Promise<void> => {
      if (!scope || !scopeKey) return;
      const workingDir = scope.workingDirectory;
      dispatch({
        type: "creationStarted",
        scopeKey,
        tabId,
        retry,
        label: label ?? workingDir ?? "Terminal",
        actionId,
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
        const created = await startHostTerminal(dependencies.hostClient, {
          workingDir,
          context: scope.context,
          actionId,
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
            await invalidateTerminalList(queryClient, listFilter);
          }
          return;
        }
        dispatch({ type: "creationCompleted", scopeKey, tabId, summary: created.summary });
        await invalidateTerminalList(queryClient, listFilter);
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

  const { refetch } = terminalQuery;
  const retryDiscovery = useCallback((): void => {
    if (scopeKey) void refetch();
  }, [refetch, scopeKey]);
  const retryCreate = useCallback(
    (ownerScopeKey: string, tabId: string, actionId: string | null): void => {
      if (ownerScopeKey !== scopeKey) return;
      void startTerminal({ tabId, retry: true, actionId, label: null });
    },
    [scopeKey, startTerminal],
  );
  const changeTitle = useCallback(
    (ownerScopeKey: string, terminalId: string, title: string): void => {
      dispatch({ type: "titleChanged", scopeKey: ownerScopeKey, terminalId, title });
    },
    [],
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
      if (scope) await invalidateTerminalList(queryClient, listFilter);
      return closeResult;
    },
    [controller, dependencies.hostClient, listFilter, queryClient, scope, scopeKey],
  );
  const changeLifecycle = useCallback(
    (ownerScopeKey: string, terminalId: string, lifecycle: TerminalLifecycle): void => {
      dispatch({ type: "lifecycleChanged", scopeKey: ownerScopeKey, terminalId, lifecycle });
    },
    [],
  );
  const forgetTerminal = useCallback(
    (ownerScopeKey: string, terminalId: string, message: string): void => {
      dispatch({ type: "terminalForgotten", scopeKey: ownerScopeKey, terminalId, message });
    },
    [],
  );
  const isLoading = terminalQuery.isFetching || isScopeLoading;
  const openTabs = visibleState.tabs.filter((tab) => !closingTabIds.has(tab.tabId));
  const discoveryError = terminalQuery.isError ? terminalQuery.error.message : null;
  const startBlockedReason = terminalStartBlockedReason({
    scope,
    isLoading,
    discoveryError,
    isCreating: openTabs.some((tab) => tab.requestState === "creating"),
    tabCount: openTabs.length,
  });
  const createTerminal = useCallback(
    (action?: RepoAction): string | null => {
      if (startBlockedReason !== null) return null;
      const tabId = `creating:${globalThis.crypto.randomUUID()}`;
      void startTerminal({
        tabId,
        retry: false,
        actionId: action?.id ?? null,
        label: action?.name ?? null,
      });
      return tabId;
    },
    [startBlockedReason, startTerminal],
  );

  return useMemo(
    () => ({
      scopeKey,
      isAvailable: scope !== null,
      startBlockedReason,
      tabs: visibleState.tabs,
      closingTabIds,
      runningCommandTerminalIds,
      isSynced,
      mountedTabs,
      isLoading,
      discoveryError,
      transportError,
      platform: platformQuery.data,
      platformError: platformQuery.isError ? platformQuery.error.message : null,
      controller,
      createTerminal,
      onRetryDiscovery: retryDiscovery,
      onRetryCreate: retryCreate,
      onTitleChange: changeTitle,
      onClose: closeTerminal,
      onLifecycle: changeLifecycle,
      onForgotten: forgetTerminal,
    }),
    [
      changeLifecycle,
      changeTitle,
      closeTerminal,
      closingTabIds,
      controller,
      createTerminal,
      discoveryError,
      forgetTerminal,
      isLoading,
      isSynced,
      mountedTabs,
      platformQuery.data,
      platformQuery.error,
      platformQuery.isError,
      runningCommandTerminalIds,
      retryCreate,
      retryDiscovery,
      scope,
      scopeKey,
      startBlockedReason,
      transportError,
      visibleState.tabs,
    ],
  );
};

type MountedTab = {
  scopeKey: string;
  tab: TerminalTab;
};

type TerminalCreation = {
  tabId: string;
  /** Restarts creation in the failed tab `tabId` instead of a new tab. */
  retry: boolean;
  /** The repository action that the new terminal runs. */
  actionId: string | null;
  label: string | null;
};

const startHostTerminal = (
  hostClient: TerminalDependencies["hostClient"],
  { workingDir, context, actionId }: TerminalOwnedLaunchSpec & { actionId: string | null },
): Promise<TerminalCreateResponse> =>
  actionId === null
    ? hostClient.terminalCreate({ workingDir, context })
    : hostClient.terminalRunAction({ workingDir, context, actionId });

const MAX_SCOPE_TERMINALS = 8;

// A start during discovery or another start could duplicate a terminal or run a command twice.
const terminalStartBlockedReason = ({
  scope,
  isLoading,
  discoveryError,
  isCreating,
  tabCount,
}: {
  scope: TerminalScope | null;
  isLoading: boolean;
  discoveryError: string | null;
  isCreating: boolean;
  tabCount: number;
}): string | null => {
  if (scope === null) return "Select a task or chat to use terminals.";
  if (scope.workingDirectory === null) return scope.workingDirectoryError;
  if (isLoading) return "Terminals are loading.";
  if (discoveryError !== null) return "Terminal discovery failed. Retry it in the bottom panel.";
  if (isCreating) return "A terminal is starting.";
  if (tabCount >= MAX_SCOPE_TERMINALS) {
    return `Close a terminal to start another. The limit is ${MAX_SCOPE_TERMINALS} terminals.`;
  }
  return null;
};

const defaultDependencies = (): TerminalDependencies => ({
  hostClient: host,
  terminalBridge: getShellBridge().terminals,
});

const filterForContext = (context: TerminalOwnedContext | null): TerminalListFilter => {
  if (context === null) return { kind: "all" };
  if ("taskId" in context) {
    return { kind: "task", repoPath: context.repoPath, taskId: context.taskId };
  }
  return {
    kind: "workspace_session",
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
  };
};
