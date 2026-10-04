import type { RepoStoreHealth, TaskStoreCheck } from "@openducktor/contracts";
import { isCancelledError } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { getBlockingRepoStoreHealth, summarizeTaskLoadError } from "@/state/tasks/task-load-errors";

export const TASK_STORE_PREPARATION_TOAST_DELAY_MS = 1_000;

type ToastId = string | number;

export type LifecycleNotificationPort = {
  error: (title: string, description: string) => void;
  loading: (title: string, description: string) => ToastId;
  success: (title: string, description: string) => void;
  dismiss: (id: ToastId) => void;
};

export type LifecycleTimerPort<TimerHandle> = {
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (timer: TimerHandle) => void;
};

type RepositoryLoadInput<TimerHandle> = {
  repoPath: string;
  isCurrent: () => boolean;
  refreshBranches: (force?: boolean) => Promise<void>;
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
  loadWorkspaceTasks: (repoPath: string) => Promise<void>;
  notifications: LifecycleNotificationPort;
  timers: LifecycleTimerPort<TimerHandle>;
  taskStorePreparationToastDelayMs?: number;
};

export const startRepositoryLoad = <TimerHandle>({
  repoPath,
  isCurrent,
  refreshBranches,
  refreshTaskStoreCheckForRepo,
  loadWorkspaceTasks,
  notifications,
  timers,
  taskStorePreparationToastDelayMs = TASK_STORE_PREPARATION_TOAST_DELAY_MS,
}: RepositoryLoadInput<TimerHandle>): (() => void) => {
  let disposed = false;
  let taskStorePreparationToastId: ToastId | null = null;
  let hadTaskStorePreparationToast = false;
  let taskStorePreparationTimer: TimerHandle | null = null;
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

      type TaskLoadFailure = { error: unknown };
      let taskLoadResult: TaskLoadFailure | null;
      try {
        await loadWorkspaceTasks(repoPath);
        taskLoadResult = null;
      } catch (error) {
        taskLoadResult = { error };
      }

      if (!taskStoreCheck.repoStoreHealth.isReady) {
        try {
          const refreshedTaskStoreCheck = await refreshTaskStoreCheckForRepo(repoPath, true);
          repoStoreHealth = getBlockingRepoStoreHealth(refreshedTaskStoreCheck);
        } catch {
          // The task load is the primary operation; a follow-up diagnostic must not replace its error.
        }
      }

      if (taskLoadResult !== null) {
        throw taskLoadResult.error;
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

  void refreshBranches(false).catch((cause: unknown) => {
    if (isActive()) {
      notifications.error("Repository branches unavailable", errorMessage(cause));
    }
  });
  void taskLoadPromise.catch((cause: unknown) => {
    if (isActive() && !isCancelledError(cause)) {
      notifications.error(
        "Repository tasks unavailable",
        summarizeTaskLoadError({ error: cause, repoStoreHealth }),
      );
    }
  });

  return () => {
    disposed = true;
    clearTaskStorePreparationTimer();
    dismissTaskStorePreparationToast();
  };
};
