import { getScopedRepoConfig } from "../support/scoped-repo-config";
import type {
  TaskAutoCloseFailure,
  TaskMergeStatusSnapshot,
  WorkspaceRef,
} from "@openducktor/contracts";
import { Clock, Effect, Exit, Scope, Semaphore } from "effect";
import { canonicalTargetBranch, targetBranchRef } from "../../../domain/task";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import { createKeyedSharedFlight } from "../../../effect/shared-flight";
import type { GitPort, GitPortError } from "../../../ports/git-port";
import type { SettingsConfigError, SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskStoreError, TaskStorePort } from "../../../ports/task-repository-ports";
import type { RemoteFetchService } from "../../git/remote-fetch-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../../workspaces/workspace-settings-service";
import {
  listTaskBranchTips,
  readCanonicalManagedWorktreeBase,
  relatedTaskBranchTips,
  taskBranchRefPattern,
} from "../support/task-branch-tips";
import { checkMovedTasks, type MovedTask } from "./task-merge-batch";
import {
  type Entry,
  failedEntry,
  hasStatusChange,
  keptOf,
  knownOwnCommit,
  type PendingCheck,
  planTaskCheck,
  withCheckedAt,
} from "./task-merge-entries";

/** The task checks of all workspaces run at most this many Git commands at a time. */
const CHECK_CONCURRENCY = 4;

export type TaskMergeDetectionError =
  | GitPortError
  | HostOperationError
  | HostValidationError
  | SettingsConfigError
  | TaskStoreError
  | WorkspaceSettingsError;

export type TaskMergeDetectionService = {
  /** The latest snapshot of a workspace. It is empty before the first pass. */
  getSnapshot(workspace: WorkspaceRef): Effect.Effect<TaskMergeStatusSnapshot>;
  /**
   * Runs a pass that fetches the target remotes again, and returns its snapshot. It fails when the
   * workspace cannot run a pass.
   */
  checkWorkspace(
    workspace: WorkspaceRef,
  ): Effect.Effect<TaskMergeStatusSnapshot, TaskMergeDetectionError>;
  /**
   * Runs a scheduled pass of an open workspace. It skips a remote fetch of the last 5 minutes. A
   * call during a pass of the same workspace waits for that pass and gets its snapshot.
   */
  runPass(workspace: WorkspaceRef): Effect.Effect<TaskMergeStatusSnapshot, TaskMergeDetectionError>;
  /**
   * Keeps the merged tasks that one pull request sync could not close, in memory only. A task that
   * this sync did not fail to close loses its failure. It returns the failures of tasks that had
   * none before, so each blocked close notifies once.
   */
  recordAutoCloseFailures(
    workspace: WorkspaceRef,
    failures: ReadonlyArray<{ taskId: string; message: string }>,
  ): Effect.Effect<TaskAutoCloseFailure[]>;
  shutdown(): Effect.Effect<void>;
};

export type CreateTaskMergeDetectionServiceInput = {
  taskStore: Pick<TaskStorePort, "listMergeCandidates" | "listDirectMergeTaskIds">;
  gitPort: GitPort;
  /** The fetch that the Git panel shares, so each remote fetches once for both. */
  remoteFetch: RemoteFetchService;
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfig" | "getWorkspaceCatalog">;
  publish(snapshot: TaskMergeStatusSnapshot): void;
  logger: { error(message: string): Effect.Effect<void, unknown> };
};

export const createTaskMergeDetectionService = ({
  taskStore,
  gitPort,
  remoteFetch,
  settingsConfig,
  workspaceSettingsService,
  publish,
  logger,
}: CreateTaskMergeDetectionServiceInput): TaskMergeDetectionService => {
  const entries = new Map<string, Map<string, Entry>>();
  const autoCloseFailures = new Map<string, Map<string, TaskAutoCloseFailure>>();
  // The service scope owns each pass, so a caller that stops waiting does not stop it.
  const scope = Scope.makeUnsafe();
  const passes = createKeyedSharedFlight<string, TaskMergeStatusSnapshot, TaskMergeDetectionError>({
    scope,
  });
  // Many workspaces can run passes together, so one limit holds for all of them.
  const checks = Semaphore.makeUnsafe(CHECK_CONCURRENCY);

  const workspaceKey = (workspace: WorkspaceRef) =>
    JSON.stringify([workspace.workspaceId, workspace.repoPath]);
  const snapshotOf = (workspace: WorkspaceRef): TaskMergeStatusSnapshot => ({
    ...workspace,
    tasks: [...(entries.get(workspaceKey(workspace))?.values() ?? [])].map((entry) => entry.status),
    autoCloseFailures: [...(autoCloseFailures.get(workspaceKey(workspace))?.values() ?? [])],
  });

  /** Why a workspace runs no pass, or null when it is open and its removal is complete. */
  const skipReason = (workspace: WorkspaceRef) =>
    Effect.gen(function* () {
      const catalog = yield* workspaceSettingsService.getWorkspaceCatalog();
      const matches = (record: WorkspaceRef) =>
        record.workspaceId === workspace.workspaceId && record.repoPath === workspace.repoPath;
      if (catalog.incompleteRemovals.some((removal) => matches(removal.workspace))) {
        return "Workspace removal is incomplete. Finish removal from the workspace rail.";
      }
      if (catalog.openWorkspaces.some(matches)) return null;
      return catalog.closedWorkspaces.some(matches)
        ? "The workspace is closed. Reopen it to check the merge status of its tasks."
        : "No open workspace uses this repository. Open the workspace first.";
    });

  const startPass = (workspace: WorkspaceRef, force: boolean) =>
    passes.run(workspaceKey(workspace), detectWorkspace(workspace, force));

  const detectWorkspace = (workspace: WorkspaceRef, force: boolean) =>
    Effect.gen(function* () {
      const key = workspaceKey(workspace);
      const last = entries.get(key) ?? new Map<string, Entry>();
      const checkedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      const detected = yield* Effect.result(detectEntries(workspace, last, checkedAt, force));
      if (detected._tag === "Failure") {
        // Each task keeps its last result and shows why this pass failed.
        const message = errorMessage(detected.failure);
        entries.set(
          key,
          new Map(
            [...last].map(([taskId, entry]) => [
              taskId,
              failedEntry(entry.status, message, checkedAt, entry),
            ]),
          ),
        );
        const failed = entries.get(key);
        if (failed && hasStatusChange(last, failed)) publish(snapshotOf(workspace));
        return yield* Effect.fail(detected.failure);
      }
      entries.set(key, detected.success);
      const snapshot = snapshotOf(workspace);
      // A pass that changes only check times publishes nothing, so readers keep their data.
      if (hasStatusChange(last, detected.success)) publish(snapshot);
      return snapshot;
    });

  const detectEntries = (
    workspace: WorkspaceRef,
    last: ReadonlyMap<string, Entry>,
    checkedAt: string,
    force: boolean,
  ) =>
    Effect.gen(function* () {
      const { repoPath } = workspace;
      const next = new Map<string, Entry>();
      // A closed task is never a candidate, so the read leaves out the closed history.
      const candidates = yield* taskStore.listMergeCandidates(workspace);
      // Without candidates, the pass makes no Git call.
      if (candidates.length === 0) return next;
      const repoConfig = yield* getScopedRepoConfig(workspaceSettingsService, workspace);
      if (repoConfig.repoPath !== workspace.repoPath)
        return yield* new HostValidationError({
          field: "repoPath",
          message: "The workspace repository changed before merge detection. Reload the workspace.",
          details: workspace,
        });
      const gitRepoPath = yield* gitPort.canonicalizePath(repoConfig.repoPath);
      const worktreeBase = yield* readCanonicalManagedWorktreeBase(
        gitPort,
        settingsConfig,
        repoConfig,
      );
      const branchTips = yield* listTaskBranchTips(gitPort, gitRepoPath, repoConfig.branchPrefix);
      const directMergeTaskIds = new Set(yield* taskStore.listDirectMergeTaskIds(workspace));
      const pending: PendingCheck[] = [];
      for (const task of candidates) {
        const plan = planTaskCheck(task, {
          relatedTips: relatedTaskBranchTips(branchTips, repoConfig.branchPrefix, task.id),
          taskWorktreePath: settingsConfig.join(worktreeBase, task.id),
          defaultTarget: repoConfig.defaultTargetBranch,
          hasPendingDirectMerge: directMergeTaskIds.has(task.id),
          last: last.get(task.id),
          checkedAt,
        });
        if (plan?.kind === "entry") next.set(task.id, plan.entry);
        if (plan?.kind === "check") pending.push(plan.check);
      }

      const failedRemotes = yield* fetchTargetRemotes(repoPath, gitRepoPath, pending, force);
      const fetched: PendingCheck[] = [];
      for (const check of pending) {
        const { remote } = check.status.targetBranch;
        const fetchFailure = remote === undefined ? undefined : failedRemotes.get(remote);
        if (fetchFailure === undefined) fetched.push(check);
        // The local tips did not move, so the last check still holds for them.
        else
          next.set(
            check.status.taskId,
            failedEntry(check.status, fetchFailure, checkedAt, keptOf(check)),
          );
      }
      const targetTips = yield* gitPort.listRefTips(gitRepoPath, [
        ...new Set(fetched.map((check) => targetBranchRef(check.status.targetBranch))),
      ]);
      const toCheck: MovedTask[] = [];
      for (const check of fetched) {
        const { status, branchOid, lastTips } = check;
        const targetRef = targetBranchRef(status.targetBranch);
        const targetTip = targetTips.find((tip) => tip.ref === targetRef);
        if (!targetTip) {
          const message = `Target branch ${canonicalTargetBranch(status.targetBranch)} does not exist.`;
          next.set(status.taskId, failedEntry(status, message, checkedAt));
        } else if (lastTips?.branchOid === branchOid && lastTips.targetOid === targetTip.oid) {
          // Neither tip moved, so the last result holds and the check needs no Git call.
          next.set(status.taskId, {
            status: {
              ...status,
              result: withCheckedAt(status.result, checkedAt),
            },
            checkedTips: lastTips,
            ownCommit: knownOwnCommit(check),
          });
        } else {
          toCheck.push({ check, targetTip });
        }
      }
      const checked = yield* checkMovedTasks({
        gitPort,
        gitRepoPath,
        branchRefPattern: taskBranchRefPattern(repoConfig.branchPrefix),
        moved: toCheck,
        checkedAt,
        withPermit: (effect) => checks.withPermit(effect),
        logFailure: (taskIds, message) =>
          log(
            `Merge detection check failed for ${repoPath}, tasks ${taskIds.join(", ")}: ${message}`,
          ),
      });
      for (const entry of checked) next.set(entry.status.taskId, entry);
      // The snapshot keeps the task order, whichever check ends first.
      const ordered = new Map<string, Entry>();
      for (const task of candidates) {
        const entry = next.get(task.id);
        if (entry) ordered.set(task.id, entry);
      }
      return ordered;
    });

  /**
   * Fetches every branch of each distinct target remote once. It returns the failure message of
   * each failed remote.
   */
  const fetchTargetRemotes = (
    repoPath: string,
    gitRepoPath: string,
    pending: PendingCheck[],
    force: boolean,
  ) =>
    Effect.gen(function* () {
      const remotes = new Set<string>();
      for (const check of pending) {
        // A local target needs no fetch.
        const { remote } = check.status.targetBranch;
        if (remote !== undefined) remotes.add(remote);
      }
      const failedRemotes = new Map<string, string>();
      // Each remote has its own shared fetch, so the remotes fetch together.
      yield* Effect.forEach(
        remotes,
        (remote) =>
          Effect.gen(function* () {
            const fetched = yield* Effect.result(
              remoteFetch.fetch({ repoPath: gitRepoPath, remote, force }),
            );
            if (fetched._tag === "Success") return;
            const message = errorMessage(fetched.failure);
            yield* log(
              `Merge detection fetch failed for ${repoPath}, remote ${remote}: ${message}`,
            );
            failedRemotes.set(remote, message);
          }),
        { concurrency: "unbounded", discard: true },
      );
      return failedRemotes;
    });

  const log = (message: string) =>
    logger.error(message).pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "task-merge-detection.log",
            message: errorMessage(cause),
            cause,
          }),
      ),
    );

  return {
    getSnapshot: (workspace) => Effect.sync(() => snapshotOf(workspace)),
    checkWorkspace: (workspace) =>
      Effect.gen(function* () {
        const reason = yield* skipReason(workspace);
        if (reason !== null) {
          return yield* new HostValidationError({
            field: "repoPath",
            message: reason,
            details: workspace,
          });
        }
        return yield* startPass(workspace, true);
      }),
    runPass: (workspace) => startPass(workspace, false),
    recordAutoCloseFailures: (workspace, failures) =>
      Effect.gen(function* () {
        const key = workspaceKey(workspace);
        const last = autoCloseFailures.get(key) ?? new Map<string, TaskAutoCloseFailure>();
        const now = new Date(yield* Clock.currentTimeMillis).toISOString();
        // `failedAt` stays the time of the first failure, so a later sync changes only the message.
        const next = new Map(
          failures.map(({ taskId, message }) => [
            taskId,
            { taskId, message, failedAt: last.get(taskId)?.failedAt ?? now },
          ]),
        );
        if (next.size === 0) autoCloseFailures.delete(key);
        else autoCloseFailures.set(key, next);
        const changed =
          next.size !== last.size ||
          [...next.values()].some(
            (failure) => last.get(failure.taskId)?.message !== failure.message,
          );
        if (changed) publish(snapshotOf(workspace));
        return [...next.values()].filter((failure) => !last.has(failure.taskId));
      }),
    shutdown: () => Scope.close(scope, Exit.void),
  };
};
