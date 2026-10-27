import { type Cause, Deferred, Effect, Exit, Ref } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
import type {
  TaskMergeDetectionError,
  TaskMergeDetectionService,
} from "../merge-detection/task-merge-detection-service";
import type { RepoPullRequestSyncResult, TaskServiceError } from "../task-service";
import { workspaceSyncSkip } from "./pull-request-sync-target";

const DEFAULT_TASK_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Workspaces sync this many at a time, so a slow remote or provider does not delay the others. */
const WORKSPACE_SYNC_CONCURRENCY = 4;

type TaskSyncStep = "workspace_list" | "pull_request_sync" | "merge_detection";
const TASK_SYNC_STEP_LABELS = {
  workspace_list: "Workspace list",
  pull_request_sync: "Pull request sync",
  merge_detection: "Merge detection",
} satisfies Record<TaskSyncStep, string>;

export type TaskSyncLifecycleLogger = {
  error(message: string): Effect.Effect<void, unknown>;
};

export type TaskSyncLoopHandle = {
  /**
   * Stops scheduling work without waiting for an active pull request sync or merge detection pass.
   * It still waits for the lifecycle log writes that started before the stop.
   */
  stop(): Effect.Effect<void, HostOperationError>;
};

export type TaskSyncError =
  | HostOperationError
  | TaskMergeDetectionError
  | TaskServiceError
  | WorkspaceSettingsError;

export type TaskSyncLoop = {
  /**
   * Syncs the pull requests of each open workspace, and then runs its merge detection pass. A
   * workspace failure must not block other workspaces. A failed log write stops the run.
   */
  syncOpenWorkspaces(): Effect.Effect<void, TaskSyncError>;
  startTaskSyncLoop(): Effect.Effect<TaskSyncLoopHandle, never>;
};

export type CreateTaskSyncLoopInput = {
  intervalMs?: number | undefined;
  logger?: TaskSyncLifecycleLogger | undefined;
  mergeDetection: Pick<TaskMergeDetectionService, "runPass">;
  onBackgroundFailure(failure: HostOperationError): Effect.Effect<void, never>;
  syncRepoPullRequests(
    repoPath: string,
  ): Effect.Effect<RepoPullRequestSyncResult, TaskServiceError>;
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    "listWorkspaces" | "getWorkspaceCatalog"
  >;
};

type TaskSyncLoopState = {
  activeLogs: ReadonlySet<Deferred.Deferred<void, HostOperationError>>;
  stopped: boolean;
  terminalLogCause: Cause.Cause<HostOperationError> | null;
};

type OnSyncFailure = (
  error: TaskSyncError,
  step: TaskSyncStep,
  repoPath?: string,
) => Effect.Effect<void, HostOperationError>;

const defaultTaskSyncLifecycleLogger: TaskSyncLifecycleLogger = {
  error: (message) => Effect.sync(() => console.error(message)),
};

export const createTaskSyncLoop = ({
  intervalMs = DEFAULT_TASK_SYNC_INTERVAL_MS,
  logger = defaultTaskSyncLifecycleLogger,
  mergeDetection,
  onBackgroundFailure,
  syncRepoPullRequests,
  workspaceSettingsService,
}: CreateTaskSyncLoopInput): TaskSyncLoop => {
  const logSyncFailure: OnSyncFailure = (error, step, repoPath) => {
    const message = error instanceof Error ? error.message : String(error);
    const detail = repoPath ? `${repoPath}: ${message}` : message;
    return logger
      .error(
        `${TASK_SYNC_STEP_LABELS[step]} iteration failed; the scheduler will retry on the next interval: ${detail}`,
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation: "task-sync.log-iteration-failure",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        ),
        Effect.tapError(onBackgroundFailure),
      );
  };

  const syncWorkspace = (
    workspace: { workspaceId: string; repoPath: string },
    onFailure: OnSyncFailure,
  ) =>
    Effect.gen(function* () {
      const { repoPath } = workspace;
      // The workspace list is older than this sync, so the workspace can be closed or removed now.
      const catalog = yield* Effect.result(workspaceSettingsService.getWorkspaceCatalog());
      if (catalog._tag === "Failure") {
        return yield* onFailure(catalog.failure, "workspace_list", repoPath);
      }
      if (workspaceSyncSkip(catalog.success, repoPath, workspace.workspaceId)) return;
      // The pull request sync runs first, so it closes merged pull requests before detection.
      yield* syncRepoPullRequests(repoPath).pipe(
        Effect.catch((error) => onFailure(error, "pull_request_sync", repoPath)),
      );
      yield* mergeDetection
        .runPass(repoPath)
        .pipe(Effect.catch((error) => onFailure(error, "merge_detection", repoPath)));
    });

  const syncOpenWorkspaces = (onFailure: OnSyncFailure = logSyncFailure) =>
    Effect.gen(function* () {
      const workspaces = yield* Effect.result(workspaceSettingsService.listWorkspaces());
      if (workspaces._tag === "Failure") {
        return yield* onFailure(workspaces.failure, "workspace_list");
      }
      yield* Effect.forEach(
        workspaces.success,
        (workspace) => syncWorkspace(workspace, onFailure),
        {
          concurrency: WORKSPACE_SYNC_CONCURRENCY,
          discard: true,
        },
      );
    });

  // Finish logs that start before shutdown so stop() can report a write failure.
  const logLoopFailure = (
    state: Ref.Ref<TaskSyncLoopState>,
    error: TaskSyncError,
    step: TaskSyncStep,
    repoPath?: string,
  ): Effect.Effect<void, HostOperationError> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const completion = yield* Deferred.make<void, HostOperationError>();
        const canLog = yield* Ref.modify(state, (current) => {
          if (current.stopped) {
            return [false, current];
          }
          return [true, { ...current, activeLogs: new Set([...current.activeLogs, completion]) }];
        });
        if (!canLog) {
          return;
        }

        const exit = yield* Effect.exit(logSyncFailure(error, step, repoPath));
        yield* Ref.update(state, (current) => ({
          ...current,
          activeLogs: new Set([...current.activeLogs].filter((log) => log !== completion)),
          terminalLogCause: Exit.isFailure(exit) ? exit.cause : current.terminalLogCause,
        }));
        yield* Deferred.done(completion, exit);
        if (Exit.isFailure(exit)) {
          return yield* Effect.failCause(exit.cause);
        }
      }),
    );

  const runSyncLoop = (state: Ref.Ref<TaskSyncLoopState>) =>
    Effect.forever(
      syncOpenWorkspaces((error, step, repoPath) =>
        logLoopFailure(state, error, step, repoPath),
      ).pipe(Effect.andThen(Effect.sleep(`${intervalMs} millis`))),
    );

  return {
    syncOpenWorkspaces: () => syncOpenWorkspaces(),
    startTaskSyncLoop() {
      return Effect.gen(function* () {
        const state = yield* Ref.make<TaskSyncLoopState>({
          activeLogs: new Set(),
          stopped: false,
          terminalLogCause: null,
        });
        const fiber = yield* Effect.forkDetach(runSyncLoop(state));
        return {
          stop: () =>
            Effect.gen(function* () {
              const shutdown = yield* Ref.modify(state, (current) => [
                {
                  activeLogs: current.activeLogs,
                  terminalLogCause: current.terminalLogCause,
                },
                { ...current, stopped: true },
              ]);
              // Do not wait for an in-flight sync iteration. Only its failure logs must finish.
              yield* Effect.sync(() => fiber.interruptUnsafe());
              for (const log of shutdown.activeLogs) {
                yield* Deferred.await(log);
              }
              if (shutdown.terminalLogCause) {
                return yield* Effect.failCause(shutdown.terminalLogCause);
              }
            }),
        };
      });
    },
  };
};
