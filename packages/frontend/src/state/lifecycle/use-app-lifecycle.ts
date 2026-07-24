import type {
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskStoreCheck,
} from "@openducktor/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
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
  onDegraded: (error: unknown) => void;
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

const lifecycleTimers: LifecycleTimerPort = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

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

  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    loadWorkspaceTasksRef.current = loadWorkspaceTasks;
  }, [activeWorkspace, loadWorkspaceTasks]);

  const runtimeKindsKey = runtimeDefinitions.map((definition) => definition.kind).join(",");

  useEffect(() => {
    const repoPath = activeWorkspace?.repoPath ?? null;
    if (!repoPath || runtimeKindsKey.length === 0) {
      return;
    }

    const runtimeKinds = runtimeKindsKey.split(",") as RuntimeKind[];
    return startRepositoryRuntimes({
      repoPath,
      runtimeKinds,
      isCurrent: () => activeWorkspaceRef.current?.repoPath === repoPath,
      startRepoRuntime,
      refreshRepoRuntimeHealth,
      notifications: lifecycleNotifications,
      timers: lifecycleTimers,
    });
  }, [activeWorkspace?.repoPath, refreshRepoRuntimeHealth, runtimeKindsKey, startRepoRuntime]);

  useEffect(() => {
    const controller = taskStreamControllerFactory({
      queryClient,
      getActiveRepoPath: () => activeWorkspaceRef.current?.repoPath ?? null,
      onDegraded: (error) => {
        const description = summarizeTaskLoadError({ error });
        toast.error("Task stream degraded", { description });
      },
    });
    void controller.start().catch((error: unknown) => {
      toast.error("Task stream unavailable", { description: errorMessage(error) });
    });
    return () => {
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
    return startRepositoryLoad({
      repoPath: activeRepoPath,
      isCurrent: () =>
        repoLoadVersionRef.current === loadVersion &&
        activeWorkspaceRef.current?.repoPath === activeRepoPath,
      refreshBranches,
      refreshTaskStoreCheckForRepo,
      loadWorkspaceTasks: (repoPath) => loadWorkspaceTasksRef.current(repoPath),
      notifications: lifecycleNotifications,
      timers: lifecycleTimers,
    });
  }, [activeWorkspace, clearBranchData, refreshTaskStoreCheckForRepo, refreshBranches]);
}
