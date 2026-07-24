import type {
  RepoStoreHealth,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskStoreCheck,
} from "@openducktor/contracts";
import { isCancelledError } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { getBlockingRepoStoreHealth, summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";

export const TASK_STORE_PREPARATION_TOAST_DELAY_MS = 1_000;

type ToastId = string | number;

export type LifecycleNotificationPort = {
  error: (title: string, description: string) => void;
  loading: (title: string, description: string) => ToastId;
  success: (title: string, description: string) => void;
  dismiss: (id: ToastId) => void;
};

export type LifecycleTimerPort = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

type RuntimeStartupInput = {
  repoPath: string;
  runtimeKinds: RuntimeKind[];
  isCurrent: () => boolean;
  startRepoRuntime: (repoPath: string, runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary>;
  refreshRepoRuntimeHealth: () => Promise<RepoRuntimeHealthMap>;
  notifications: LifecycleNotificationPort;
  timers: LifecycleTimerPort;
};

export const startRepositoryRuntimes = ({
  repoPath,
  runtimeKinds,
  isCurrent,
  startRepoRuntime,
  refreshRepoRuntimeHealth,
  notifications,
  timers,
}: RuntimeStartupInput): (() => void) => {
  let disposed = false;
  let startupStatusRefreshTimer: unknown = null;
  const isActive = (): boolean => !disposed && isCurrent();
  const refreshHealth = (): void => {
    void refreshRepoRuntimeHealth().catch((error: unknown) => {
      if (!isActive() || isCancelledError(error)) {
        return;
      }
      notifications.error("Runtime diagnostics unavailable", errorMessage(error));
    });
  };

  for (const runtimeKind of runtimeKinds) {
    void startRepoRuntime(repoPath, runtimeKind)
      .catch((error: unknown) => {
        if (!isActive()) {
          return;
        }
        notifications.error(`Runtime startup failed for ${runtimeKind}`, errorMessage(error));
      })
      .finally(() => {
        if (isActive()) {
          refreshHealth();
        }
      });
  }

  startupStatusRefreshTimer = timers.setTimeout(() => {
    startupStatusRefreshTimer = null;
    if (isActive()) {
      refreshHealth();
    }
  }, 0);

  return () => {
    disposed = true;
    if (startupStatusRefreshTimer !== null) {
      timers.clearTimeout(startupStatusRefreshTimer);
    }
  };
};

type RepositoryLoadInput = {
  repoPath: string;
  isCurrent: () => boolean;
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  loadWorkspaceTasks: (repoPath: string) => Promise<void>;
  notifications: LifecycleNotificationPort;
  timers: LifecycleTimerPort;
  taskStorePreparationToastDelayMs?: number;
};

export const startRepositoryLoad = ({
  repoPath,
  isCurrent,
  refreshBranches,
  refreshTaskStoreCheckForRepo,
  loadWorkspaceTasks,
  notifications,
  timers,
  taskStorePreparationToastDelayMs = TASK_STORE_PREPARATION_TOAST_DELAY_MS,
}: RepositoryLoadInput): (() => void) => {
  let disposed = false;
  let taskStorePreparationToastId: ToastId | null = null;
  let hadTaskStorePreparationToast = false;
  let taskStorePreparationTimer: unknown = null;
  let repoStoreHealth: RepoStoreHealth | null = null;
  const isActive = (): boolean => !disposed && isCurrent();

  const clearTaskStorePreparationTimer = (): void => {
    if (taskStorePreparationTimer !== null) {
      timers.clearTimeout(taskStorePreparationTimer);
      taskStorePreparationTimer = null;
    }
  };
  const dismissTaskStorePreparationToast = (): void => {
    if (taskStorePreparationToastId !== null) {
      notifications.dismiss(taskStorePreparationToastId);
      taskStorePreparationToastId = null;
    }
  };

  taskStorePreparationTimer = timers.setTimeout(() => {
    taskStorePreparationTimer = null;
    if (!isActive()) {
      return;
    }
    hadTaskStorePreparationToast = true;
    taskStorePreparationToastId = notifications.loading(
      "Preparing task store",
      "OpenDucktor is opening the SQLite task store for this repository.",
    );
  }, taskStorePreparationToastDelayMs);

  const taskLoadPromise = (async () => {
    try {
      const taskStoreCheck = await refreshTaskStoreCheckForRepo(repoPath, false);
      repoStoreHealth = getBlockingRepoStoreHealth(taskStoreCheck);
      if (taskStoreCheck.repoStoreHealth.isReady) {
        clearTaskStorePreparationTimer();
        dismissTaskStorePreparationToast();
      }

      let taskLoadError: unknown = null;
      try {
        await loadWorkspaceTasks(repoPath);
      } catch (error) {
        taskLoadError = error;
      }

      if (!taskStoreCheck.repoStoreHealth.isReady) {
        try {
          const refreshedTaskStoreCheck = await refreshTaskStoreCheckForRepo(repoPath, true);
          repoStoreHealth = getBlockingRepoStoreHealth(refreshedTaskStoreCheck);
        } catch {
          // The task load is the primary operation; a follow-up diagnostic must not replace its error.
        }
      }

      if (taskLoadError !== null) {
        throw taskLoadError;
      }

      if (!repoStoreHealth && hadTaskStorePreparationToast && isActive()) {
        dismissTaskStorePreparationToast();
        notifications.success("task store ready", "The task store is ready for this repository.");
      }
    } finally {
      clearTaskStorePreparationTimer();
      dismissTaskStorePreparationToast();
    }
  })();

  void refreshBranches(false).catch((error: unknown) => {
    if (isActive()) {
      notifications.error("Repository branches unavailable", errorMessage(error));
    }
  });
  void taskLoadPromise.catch((error: unknown) => {
    if (isActive() && !isCancelledError(error)) {
      notifications.error(
        "Repository tasks unavailable",
        summarizeTaskLoadError({ error, repoStoreHealth }),
      );
    }
  });

  return () => {
    disposed = true;
    clearTaskStorePreparationTimer();
    dismissTaskStorePreparationToast();
  };
};
