import type {
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskStoreCheck,
} from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { taskQueryKeys } from "@/state/queries/tasks";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import type { TaskStreamController } from "@/state/tasks/task-stream-controller";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type LifecycleNotificationPort,
  type LifecycleTimerPort,
  startRepositoryLoad,
  startRepositoryRuntimes,
} from "./app-lifecycle-coordinator";

export type TaskStreamControllerFactory = (input: {
  queryClient: QueryClient;
  getActiveRepoPath: () => string | null;
  onDegraded: (cause: unknown) => void;
  onSnapshotFinished: (repoPath: string | null, succeeded: boolean) => void;
  onSnapshotStarted: (repoPath: string | null) => void;
}) => TaskStreamController;

type UseAppLifecycleArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: RuntimeDescriptor[];
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshRepoRuntimeHealth: () => Promise<RepoRuntimeHealthMap>;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  loadWorkspaceTasks: (repoPath: string) => Promise<void>;
  startRepoRuntime: (repoPath: string, runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary>;
  clearBranchData: () => void;
  taskStreamControllerFactory: TaskStreamControllerFactory;
};

const lifecycleNotifications: LifecycleNotificationPort = {
  error: (title, description) => toast.error(title, { description }),
  loading: (title, description) => toast.loading(title, { description }),
  success: (title, description) => toast.success(title, { description }),
  dismiss: (id) => toast.dismiss(id),
};

const lifecycleTimers: LifecycleTimerPort<ReturnType<typeof setTimeout>> = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

const loadTasksWithoutStream = Promise.resolve(true);

export function useAppLifecycle({
  activeWorkspace,
  runtimeDefinitions,
  refreshBranches,
  refreshRepoRuntimeHealth,
  refreshTaskStoreCheckForRepo,
  loadWorkspaceTasks,
  startRepoRuntime,
  clearBranchData,
  taskStreamControllerFactory,
}: UseAppLifecycleArgs): void {
  const repoLoadVersionRef = useRef(0);
  const queryClient = useQueryClient();
  const activeWorkspaceRef = useRef(activeWorkspace);
  const loadWorkspaceTasksRef = useRef(loadWorkspaceTasks);
  const shouldLoadWorkspaceTasksRef = useRef<Promise<boolean>>(loadTasksWithoutStream);
  const failedStreamSnapshotReposRef = useRef<Set<string>>(new Set());
  const streamSnapshotReposRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    loadWorkspaceTasksRef.current = loadWorkspaceTasks;
  }, [activeWorkspace, loadWorkspaceTasks]);

  const runtimeKinds = useMemo(
    () => runtimeDefinitions.map((definition) => definition.kind),
    [runtimeDefinitions],
  );

  useEffect(() => {
    const repoPath = activeWorkspace?.repoPath ?? null;
    if (!repoPath || runtimeKinds.length === 0) {
      return;
    }

    return startRepositoryRuntimes({
      repoPath,
      runtimeKinds,
      isCurrent: () => activeWorkspaceRef.current?.repoPath === repoPath,
      startRepoRuntime,
      refreshRepoRuntimeHealth,
      notifications: lifecycleNotifications,
      timers: lifecycleTimers,
    });
  }, [activeWorkspace?.repoPath, refreshRepoRuntimeHealth, runtimeKinds, startRepoRuntime]);

  useEffect(() => {
    failedStreamSnapshotReposRef.current = new Set();
    streamSnapshotReposRef.current = new Set();
    let taskLoadDecisionMade = false;
    let resolveTaskLoadDecision!: (shouldLoadWorkspaceTasks: boolean) => void;
    shouldLoadWorkspaceTasksRef.current = new Promise<boolean>((resolve) => {
      resolveTaskLoadDecision = resolve;
    });
    const decideTaskLoad = (shouldLoadWorkspaceTasks: boolean): void => {
      if (taskLoadDecisionMade) {
        return;
      }
      taskLoadDecisionMade = true;
      resolveTaskLoadDecision(shouldLoadWorkspaceTasks);
    };
    const controller = taskStreamControllerFactory({
      queryClient,
      getActiveRepoPath: () => activeWorkspaceRef.current?.repoPath ?? null,
      onDegraded: (error) => {
        const description = summarizeTaskLoadError({ error });
        toast.error("Task stream degraded", { description });
      },
      onSnapshotStarted: (repoPath) => {
        if (repoPath) {
          failedStreamSnapshotReposRef.current.delete(repoPath);
          streamSnapshotReposRef.current.add(repoPath);
        }
      },
      onSnapshotFinished: (repoPath, succeeded) => {
        if (repoPath) {
          streamSnapshotReposRef.current.delete(repoPath);
          if (!succeeded) {
            failedStreamSnapshotReposRef.current.add(repoPath);
          }
        }
      },
    });
    void controller.start().then(
      () => decideTaskLoad(false),
      (cause: unknown) => {
        decideTaskLoad(true);
        toast.error("Task stream unavailable", { description: errorMessage(cause) });
      },
    );
    return () => {
      decideTaskLoad(false);
      void controller.stop();
    };
  }, [queryClient, taskStreamControllerFactory]);

  useEffect(() => {
    const activeRepoPath = activeWorkspace?.repoPath ?? null;
    if (!activeRepoPath) {
      clearBranchData();
      return;
    }

    const loadVersion = ++repoLoadVersionRef.current;
    const shouldLoadWorkspaceTasks = shouldLoadWorkspaceTasksRef.current;
    const isCurrent = () =>
      repoLoadVersionRef.current === loadVersion &&
      activeWorkspaceRef.current?.repoPath === activeRepoPath;
    return startRepositoryLoad({
      repoPath: activeRepoPath,
      isCurrent,
      refreshBranches,
      refreshTaskStoreCheckForRepo,
      loadWorkspaceTasks: async (repoPath) => {
        const streamUnavailable = await shouldLoadWorkspaceTasks;
        const taskQueryState = queryClient.getQueryState(taskQueryKeys.repoData(repoPath));
        const streamFailedForRepo = failedStreamSnapshotReposRef.current.has(repoPath);
        const streamOwnsRepo = streamSnapshotReposRef.current.has(repoPath);
        const queryOwnsRepo =
          taskQueryState?.status === "success" || taskQueryState?.fetchStatus === "fetching";
        if (
          (streamUnavailable || (!streamFailedForRepo && !streamOwnsRepo && !queryOwnsRepo)) &&
          isCurrent()
        ) {
          await loadWorkspaceTasksRef.current(repoPath);
        }
      },
      notifications: lifecycleNotifications,
      timers: lifecycleTimers,
    });
  }, [
    activeWorkspace,
    clearBranchData,
    queryClient,
    refreshTaskStoreCheckForRepo,
    refreshBranches,
  ]);
}
