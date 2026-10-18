import type { TaskStoreCheck, WorkspaceRecord } from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { taskQueryKeys } from "@/state/queries/tasks";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import type { TaskStreamController } from "@/state/tasks/task-stream-controller";
import type { ActiveWorkspace } from "@/types/state-slices";
import { type LifecycleTimerPort, startRepositoryLoad } from "./app-lifecycle-coordinator";
import { lifecycleNotifications } from "./lifecycle-notifications";
import { useOpenWorkspaceTaskLists } from "./use-open-workspace-task-lists";

export type TaskStreamControllerFactory = (input: {
  queryClient: QueryClient;
  getOpenRepoPaths: () => readonly string[];
  getActiveRepoPath: () => string | null;
  onDegraded: (cause: unknown) => void;
  onSnapshotFinished: (repoPath: string, succeeded: boolean) => void;
  onSnapshotStarted: (repoPath: string) => void;
  onWorkspaceFailures: (failures: ReadonlyMap<string, unknown>) => void;
}) => TaskStreamController;

type UseAppLifecycleArgs = {
  activeWorkspace: ActiveWorkspace | null;
  openWorkspaces: readonly Pick<WorkspaceRecord, "repoPath" | "isActive">[];
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  loadWorkspaceTasks: (repoPath: string) => Promise<void>;
  clearBranchData: () => void;
  taskStreamControllerFactory: TaskStreamControllerFactory;
};

const lifecycleTimers: LifecycleTimerPort<ReturnType<typeof setTimeout>> = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export function useAppLifecycle({
  activeWorkspace,
  openWorkspaces,
  refreshBranches,
  refreshTaskStoreCheckForRepo,
  loadWorkspaceTasks,
  clearBranchData,
  taskStreamControllerFactory,
}: UseAppLifecycleArgs): void {
  const repoLoadVersionRef = useRef(0);
  const queryClient = useQueryClient();
  const activeWorkspaceRef = useRef(activeWorkspace);
  const loadWorkspaceTasksRef = useRef(loadWorkspaceTasks);
  const streamStartRef = useRef<PromiseWithResolvers<StreamStart> | null>(null);
  // A running snapshot owns the read of a repository. A failed one keeps it, so no load retries it.
  const streamOwnedReposRef = useRef(new Set<string>());
  const controllerRef = useRef<TaskStreamController | null>(null);
  const openRepoPathsRef = useRef<readonly string[]>([]);
  const previousOpenRepoPathsRef = useRef<readonly string[]>([]);
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const openRepoPaths = useOpenWorkspaceTaskLists({ openWorkspaces, activeRepoPath });

  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    loadWorkspaceTasksRef.current = loadWorkspaceTasks;
    openRepoPathsRef.current = openRepoPaths;
  }, [activeWorkspace, loadWorkspaceTasks, openRepoPaths]);

  /** Load a list unless a stream snapshot reads it now, or a failed snapshot already tried. */
  const loadUnlessStreamOwnsRepo = useCallback(
    async (repoPath: string, streamStart: Promise<StreamStart>, isCurrent: () => boolean) => {
      const streamUnavailable = (await streamStart) === "unavailable";
      const taskQueryState = queryClient.getQueryState(taskQueryKeys.repoData(repoPath));
      const streamOwnsRepo = streamOwnedReposRef.current.has(repoPath);
      const queryOwnsRepo =
        taskQueryState?.status === "success" || taskQueryState?.fetchStatus === "fetching";
      if ((streamUnavailable || (!streamOwnsRepo && !queryOwnsRepo)) && isCurrent()) {
        await loadWorkspaceTasksRef.current(repoPath);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    const open = new Set(openRepoPaths);
    for (const repoPath of previousOpenRepoPathsRef.current) {
      if (open.has(repoPath)) continue;
      // A workspace that opens again loads without the snapshot state of this visit.
      streamOwnedReposRef.current.delete(repoPath);
      void controllerRef.current?.releaseWorkspace(repoPath);
    }
    previousOpenRepoPathsRef.current = openRepoPaths;
  }, [openRepoPaths]);

  useEffect(() => {
    // The active workspace loads after its task store check. The record flag marks it in the same
    // render as the list, while the active workspace state follows in a later transition.
    const streamStart = currentStreamStart(streamStartRef).promise;
    const isOpenAndInactive = (repoPath: string): boolean =>
      openRepoPathsRef.current.includes(repoPath) &&
      activeWorkspaceRef.current?.repoPath !== repoPath;
    // A workspace that lost focus before its first load as the active workspace is unread too.
    for (const { repoPath, isActive } of openWorkspaces) {
      if (isActive || !isUnread(queryClient, repoPath)) continue;
      loadUnlessStreamOwnsRepo(repoPath, streamStart, () => isOpenAndInactive(repoPath)).catch(
        ignoreLoadFailure,
      );
    }
  }, [loadUnlessStreamOwnsRepo, openWorkspaces, queryClient]);

  useEffect(() => {
    streamOwnedReposRef.current = new Set();
    const streamStart = currentStreamStart(streamStartRef);
    const controller = taskStreamControllerFactory({
      queryClient,
      getOpenRepoPaths: () => openRepoPathsRef.current,
      getActiveRepoPath: () => activeWorkspaceRef.current?.repoPath ?? null,
      onDegraded: (error) => {
        const description = summarizeTaskLoadError({ error });
        toast.error("Task stream degraded", { description });
      },
      onSnapshotStarted: (repoPath) => {
        streamOwnedReposRef.current.add(repoPath);
      },
      onSnapshotFinished: (repoPath, succeeded) => {
        if (succeeded) streamOwnedReposRef.current.delete(repoPath);
      },
      onWorkspaceFailures: (failures) => {
        const description = [...failures]
          .map(([repoPath, error]) => `${repoPath}: ${summarizeTaskLoadError({ error })}`)
          .join("\n");
        toast.error("Workspaces did not refresh", { description });
      },
    });
    controllerRef.current = controller;
    void controller.start().then(
      () => streamStart.resolve("started"),
      (cause: unknown) => {
        streamStart.resolve("unavailable");
        toast.error("Task stream unavailable", { description: errorMessage(cause) });
      },
    );
    return () => {
      streamStart.resolve("stopped");
      // Loads that start later wait for the next controller.
      streamStartRef.current = null;
      void controller.stop();
    };
  }, [queryClient, taskStreamControllerFactory]);

  useEffect(() => {
    if (!activeRepoPath) {
      clearBranchData();
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    const streamStart = currentStreamStart(streamStartRef).promise;
    const isCurrent = () =>
      repoLoadVersionRef.current === loadVersion &&
      activeWorkspaceRef.current?.repoPath === activeRepoPath;
    return startRepositoryLoad({
      repoPath: activeRepoPath,
      isCurrent,
      refreshBranches,
      refreshTaskStoreCheckForRepo,
      loadWorkspaceTasks: (repoPath) => loadUnlessStreamOwnsRepo(repoPath, streamStart, isCurrent),
      notifications: lifecycleNotifications,
      timers: lifecycleTimers,
    });
  }, [
    activeRepoPath,
    clearBranchData,
    loadUnlessStreamOwnsRepo,
    refreshTaskStoreCheckForRepo,
    refreshBranches,
  ]);
}

/** When the task stream is unavailable, task loads cannot wait for its snapshot. */
type StreamStart = "started" | "unavailable" | "stopped";

/** The first caller creates the stream start, so a load can wait for it in any effect order. */
const currentStreamStart = (
  ref: RefObject<PromiseWithResolvers<StreamStart> | null>,
): PromiseWithResolvers<StreamStart> => {
  ref.current ??= Promise.withResolvers<StreamStart>();
  return ref.current;
};

/** True when no read stored data or a failure and none runs now. A failed list counts as read. */
const isUnread = (queryClient: QueryClient, repoPath: string): boolean => {
  const state = queryClient.getQueryState(taskQueryKeys.repoData(repoPath));
  return state === undefined || (state.status === "pending" && state.fetchStatus === "idle");
};

const ignoreLoadFailure = (): void => {
  // TanStack Query keeps the failure for the views of this workspace to report.
};
