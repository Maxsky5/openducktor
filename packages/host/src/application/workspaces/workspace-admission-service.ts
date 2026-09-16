import type { RepoConfig } from "@openducktor/contracts";
import { Deferred, Effect, FiberId, FiberRef } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  HostOperationError,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { GitPort } from "../../ports/git-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { WorkspaceHostOwnershipPort } from "../../ports/workspace-host-ownership-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";
import { createWorkspaceRepoResolver } from "./workspace-repo-resolver";
import { createProspectiveWorkspaceTargetValidator } from "./workspace-target-ownership";

export type WorkspaceBlockReason = "closed" | "removal";
export type WorkspaceReservationOperation = "close" | "reopen" | "remove";

type BlockedWorkspace = {
  repoPath: string;
  reason: WorkspaceBlockReason;
  workspaceId: string;
};

type WorkspaceReservation = {
  operation: WorkspaceReservationOperation;
  repoPath: string;
  workspaceId: string;
};

type WorkStartState = {
  active: number;
  drained: Deferred.Deferred<void> | null;
};

export type WorkspaceAdmissionService = {
  initialize(): Effect.Effect<void, HostOperationError>;
  isWorkspaceBlocked(workspaceId: string): boolean;
  isWorkspaceRemovalPending(workspaceId: string): boolean;
  reserveWorkspace(input: {
    operation: WorkspaceReservationOperation;
    repoPath: string;
    workspaceId: string;
  }): Effect.Effect<void, HostValidationErrorAggregate>;
  releaseReservation(workspaceId: string): void;
  assertTaskStoreAccess(input: {
    operation: string;
    repoPath: string;
    workspaceId: string;
  }): Effect.Effect<void, HostValidationErrorAggregate>;
  assertWorkspaceAdmitsWork(repoPath: string): Effect.Effect<void, HostValidationErrorAggregate>;
  resolveWorkspaceRepoPath(
    workingDirectory: string,
  ): Effect.Effect<string | null, HostValidationErrorAggregate>;
  awaitWorkStarts(repoPath: string): Effect.Effect<void, HostValidationErrorAggregate>;
  withWorkStartLease<A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
    workingDirectory?: string,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R>;
  blockWorkspace(input: {
    reason: WorkspaceBlockReason;
    repoPath: string;
    workspaceId: string;
  }): void;
  unblockWorkspace(workspaceId: string): void;
  forgetWorkspaceWhenDrained(input: {
    repoPath: string;
    workspaceId: string;
  }): Effect.Effect<boolean>;
  withAdministrativeAccess<A, E, R>(
    workspaceIds: readonly string[],
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>;
};

export const createWorkspaceAdmissionService = ({
  gitPort,
  hostOwnership,
  settingsConfig,
  worktreeFiles,
  workspaceSettingsService,
}: {
  gitPort: Pick<
    GitPort,
    "isGitRepository" | "isRegisteredWorktree" | "listWorktrees" | "shareGitCommonDirectory"
  >;
  hostOwnership: Pick<WorkspaceHostOwnershipPort, "claimWorkspace">;
  settingsConfig: Pick<SettingsConfigPort, "canonicalizePath" | "pathExists">;
  worktreeFiles: Pick<WorktreeFilePort, "resolvePathWithinRoot">;
  workspaceSettingsService: Pick<
    WorkspaceSettingsService,
    "getRepoConfig" | "getRepoConfigByRepoPath" | "getWorkspaceCatalog"
  >;
}): WorkspaceAdmissionService => {
  const blockedByWorkspaceId = new Map<string, BlockedWorkspace>();
  const reservationsByWorkspaceId = new Map<string, WorkspaceReservation>();
  const workStartsByRepoPath = new Map<string, WorkStartState>();
  const administrativeWorkspaceIds = FiberRef.unsafeMake<ReadonlySet<string>>(new Set());
  let initialized = false;
  const resolveWorkspaceRepoPath = createWorkspaceRepoResolver({
    gitPort,
    workspaceSettingsService,
  });
  const assertProspectiveWorkspaceTarget = createProspectiveWorkspaceTargetValidator({
    worktreeFiles,
    workspaceSettingsService,
  });

  const replaceBlocked = (nextBlocked: BlockedWorkspace[]): void => {
    blockedByWorkspaceId.clear();
    for (const blocked of nextBlocked) {
      blockedByWorkspaceId.set(blocked.workspaceId, blocked);
    }
    initialized = true;
  };

  const initialize = (): Effect.Effect<void, HostOperationError> =>
    workspaceSettingsService.getWorkspaceCatalog().pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "workspaceAdmission.initialize",
            message: cause.message,
            cause,
          }),
      ),
      Effect.tap((catalog) =>
        Effect.sync(() =>
          replaceBlocked([
            ...catalog.closedWorkspaces.map((workspace) => ({
              repoPath: workspace.repoPath,
              reason: "closed" as const,
              workspaceId: workspace.workspaceId,
            })),
            ...catalog.incompleteRemovals.map((removal) => ({
              repoPath: removal.workspace.repoPath,
              reason: "removal" as const,
              workspaceId: removal.workspace.workspaceId,
            })),
          ]),
        ),
      ),
      Effect.asVoid,
    );

  const ensureInitialized = (): Effect.Effect<void, HostValidationErrorAggregate> =>
    initialized
      ? Effect.void
      : initialize().pipe(
          Effect.mapError(
            (cause) =>
              new HostValidationError({
                message: cause.message,
                cause,
              }),
          ),
        );

  const claimWorkspace = (workspaceId: string): Effect.Effect<void, HostValidationErrorAggregate> =>
    hostOwnership.claimWorkspace(workspaceId).pipe(
      Effect.mapError(
        (cause) =>
          new HostValidationError({
            message: cause.message,
            field: "workspaceId",
            cause,
          }),
      ),
    );

  const persistedBlock = (repoConfig: RepoConfig): BlockedWorkspace | undefined => {
    let reason: WorkspaceBlockReason | undefined;
    if (repoConfig.removal) {
      reason = "removal";
    } else if (repoConfig.closed) {
      reason = "closed";
    }
    if (!reason) {
      blockedByWorkspaceId.delete(repoConfig.workspaceId);
      return undefined;
    }
    const blocked = {
      reason,
      repoPath: repoConfig.repoPath,
      workspaceId: repoConfig.workspaceId,
    } satisfies BlockedWorkspace;
    blockedByWorkspaceId.set(repoConfig.workspaceId, blocked);
    return blocked;
  };

  const claimWorkspaceForRepoPath = (
    repoPath: string,
  ): Effect.Effect<void, HostValidationErrorAggregate> =>
    workspaceSettingsService.getRepoConfigByRepoPath(repoPath).pipe(
      Effect.mapError(
        (cause) =>
          new HostValidationError({
            message: cause.message,
            field: "repoPath",
            cause,
          }),
      ),
      Effect.flatMap((repoConfig) => {
        const blocked = persistedBlock(repoConfig);
        return blocked
          ? Effect.fail(blockedWorkspaceError(blocked))
          : claimWorkspace(repoConfig.workspaceId);
      }),
    );

  const assertTaskStoreAccess: WorkspaceAdmissionService["assertTaskStoreAccess"] = (input) =>
    Effect.gen(function* () {
      yield* ensureInitialized();
      const administrativeIds = yield* FiberRef.get(administrativeWorkspaceIds);
      if (administrativeIds.has(input.workspaceId)) {
        return;
      }
      const reservation = reservationsByWorkspaceId.get(input.workspaceId);
      if (reservation) {
        return yield* Effect.fail(reservedWorkspaceError(reservation));
      }
      const repoConfig = yield* workspaceSettingsService.getRepoConfig(input.workspaceId).pipe(
        Effect.mapError(
          (cause) =>
            new HostValidationError({
              message: cause.message,
              field: "workspaceId",
              cause,
            }),
        ),
      );
      const blocked = persistedBlock(repoConfig);
      if (blocked) {
        return yield* Effect.fail(blockedWorkspaceError(blocked));
      }
      yield* claimWorkspace(input.workspaceId);
    });

  const canonicalRepoPathKey = (
    repoPath: string,
  ): Effect.Effect<string, HostValidationErrorAggregate> =>
    settingsConfig.canonicalizePath(repoPath).pipe(
      Effect.map((canonicalPath) => normalizePathForComparison(canonicalPath)),
      Effect.mapError(
        (cause) =>
          new HostValidationError({
            message: `Cannot resolve the repository path ${repoPath}. Check the path and retry.`,
            field: "repoPath",
            cause,
          }),
      ),
    );

  const assertWorkspaceTarget = (
    repoPath: string,
    repoPathKey: string,
    workingDirectory: string,
  ): Effect.Effect<void, HostValidationErrorAggregate> =>
    Effect.gen(function* () {
      if (normalizePathForComparison(workingDirectory) === normalizePathForComparison(repoPath)) {
        return;
      }
      const mapCheckError = (cause: unknown) =>
        new HostValidationError({
          message: `Cannot verify the working directory ${workingDirectory}. Check the path and retry.`,
          field: "workingDirectory",
          cause,
        });
      const targetExists = yield* settingsConfig
        .pathExists(workingDirectory)
        .pipe(Effect.mapError(mapCheckError));
      if (!targetExists) {
        const registered = yield* gitPort
          .isRegisteredWorktree(repoPath, workingDirectory)
          .pipe(Effect.mapError(mapCheckError));
        if (!registered) {
          yield* assertProspectiveWorkspaceTarget(repoPath, workingDirectory);
        }
        return;
      }
      const canonicalWorkingDirectory = yield* settingsConfig
        .canonicalizePath(workingDirectory)
        .pipe(Effect.mapError(mapCheckError));
      if (normalizePathForComparison(canonicalWorkingDirectory) === repoPathKey) {
        return;
      }
      const ownerRepoPath = yield* resolveWorkspaceRepoPath(canonicalWorkingDirectory);
      if (ownerRepoPath !== null && normalizePathForComparison(ownerRepoPath) !== repoPathKey) {
        return yield* new HostValidationError({
          message: `Working directory ${workingDirectory} belongs to workspace ${ownerRepoPath}, not ${repoPath}.`,
          field: "workingDirectory",
        });
      }
      const sharesGitDirectory = yield* gitPort
        .shareGitCommonDirectory(repoPath, canonicalWorkingDirectory)
        .pipe(Effect.mapError(mapCheckError));
      const registered = sharesGitDirectory
        ? yield* gitPort
            .isRegisteredWorktree(repoPath, canonicalWorkingDirectory)
            .pipe(Effect.mapError(mapCheckError))
        : false;
      if (!registered) {
        return yield* new HostValidationError({
          message: `Working directory ${workingDirectory} is not the repository or a registered worktree of ${repoPath}.`,
          field: "workingDirectory",
        });
      }
    });

  const assertCanonicalWorkspaceAdmitsWork = (
    key: string,
  ): Effect.Effect<void, HostValidationErrorAggregate> =>
    ensureInitialized().pipe(
      Effect.flatMap(() => {
        const reservation = [...reservationsByWorkspaceId.values()].find(
          (candidate) => normalizePathForComparison(candidate.repoPath) === key,
        );
        if (reservation) {
          return Effect.fail(reservedWorkspaceError(reservation));
        }
        return Effect.void;
      }),
    );

  const assertWorkspaceAdmitsWork: WorkspaceAdmissionService["assertWorkspaceAdmitsWork"] = (
    repoPath,
  ) =>
    canonicalRepoPathKey(repoPath).pipe(
      Effect.flatMap(assertCanonicalWorkspaceAdmitsWork),
      Effect.zipRight(claimWorkspaceForRepoPath(repoPath)),
    );

  const acquireWorkStart = (key: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const state = workStartsByRepoPath.get(key) ?? {
        active: 0,
        drained: null,
      };
      state.active += 1;
      workStartsByRepoPath.set(key, state);
      return Effect.void;
    });

  const releaseWorkStart = (key: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const state = workStartsByRepoPath.get(key);
      if (!state || state.active === 0) {
        return Effect.void;
      }
      state.active -= 1;
      if (state.active > 0 || !state.drained) {
        return Effect.void;
      }
      const waiter = state.drained;
      state.drained = null;
      return Deferred.succeed(waiter, undefined).pipe(Effect.asVoid);
    });

  const activeWorkStartCount = (key: string): number => workStartsByRepoPath.get(key)?.active ?? 0;

  const awaitWorkStartDrain = (key: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const state = workStartsByRepoPath.get(key);
      if (!state || state.active === 0) {
        return Effect.void;
      }
      if (!state.drained) {
        state.drained = Deferred.unsafeMake<void>(FiberId.none);
      }
      return Deferred.await(state.drained);
    });

  const withWorkStartLease: WorkspaceAdmissionService["withWorkStartLease"] = (
    repoPath,
    effect,
    workingDirectory = repoPath,
  ) =>
    Effect.gen(function* () {
      const arrivalKey = normalizePathForComparison(repoPath);
      return yield* Effect.acquireUseRelease(
        acquireWorkStart(arrivalKey),
        () =>
          canonicalRepoPathKey(repoPath).pipe(
            Effect.flatMap((key) =>
              key === arrivalKey
                ? assertCanonicalWorkspaceAdmitsWork(key).pipe(
                    Effect.zipRight(claimWorkspaceForRepoPath(repoPath)),
                    Effect.zipRight(assertWorkspaceTarget(repoPath, key, workingDirectory)),
                    Effect.zipRight(effect),
                  )
                : Effect.acquireUseRelease(
                    acquireWorkStart(key),
                    () =>
                      assertCanonicalWorkspaceAdmitsWork(key).pipe(
                        Effect.zipRight(claimWorkspaceForRepoPath(repoPath)),
                        Effect.zipRight(assertWorkspaceTarget(repoPath, key, workingDirectory)),
                        Effect.zipRight(effect),
                      ),
                    () => releaseWorkStart(key),
                  ),
            ),
          ),
        () => releaseWorkStart(arrivalKey),
      );
    });

  const awaitWorkStarts: WorkspaceAdmissionService["awaitWorkStarts"] = (repoPath) =>
    Effect.gen(function* () {
      const arrivalKey = normalizePathForComparison(repoPath);
      yield* awaitWorkStartDrain(arrivalKey);
      const canonicalKey = yield* canonicalRepoPathKey(repoPath).pipe(
        Effect.orElseSucceed(() => arrivalKey),
      );
      if (canonicalKey !== arrivalKey) {
        yield* awaitWorkStartDrain(canonicalKey);
      }
    });

  return {
    initialize,
    isWorkspaceBlocked: (workspaceId) => blockedByWorkspaceId.has(workspaceId),
    isWorkspaceRemovalPending: (workspaceId) =>
      blockedByWorkspaceId.get(workspaceId)?.reason === "removal",
    reserveWorkspace: (input) =>
      Effect.suspend(() => {
        const existing = reservationsByWorkspaceId.get(input.workspaceId);
        if (existing) {
          return Effect.fail(reservedWorkspaceError(existing));
        }
        reservationsByWorkspaceId.set(input.workspaceId, input);
        return Effect.void;
      }),
    releaseReservation: (workspaceId) => {
      reservationsByWorkspaceId.delete(workspaceId);
    },
    assertTaskStoreAccess,
    assertWorkspaceAdmitsWork,
    resolveWorkspaceRepoPath,
    awaitWorkStarts,
    withWorkStartLease,
    blockWorkspace: (input) => {
      blockedByWorkspaceId.set(input.workspaceId, input);
    },
    unblockWorkspace: (workspaceId) => {
      blockedByWorkspaceId.delete(workspaceId);
      reservationsByWorkspaceId.delete(workspaceId);
    },
    forgetWorkspaceWhenDrained: (input) =>
      Effect.gen(function* () {
        const arrivalKey = normalizePathForComparison(input.repoPath);
        const canonicalKey = yield* canonicalRepoPathKey(input.repoPath).pipe(
          Effect.orElseSucceed(() => arrivalKey),
        );
        return yield* Effect.suspend(() => {
          if (
            activeWorkStartCount(arrivalKey) > 0 ||
            (canonicalKey !== arrivalKey && activeWorkStartCount(canonicalKey) > 0)
          ) {
            return Effect.succeed(false);
          }
          blockedByWorkspaceId.delete(input.workspaceId);
          reservationsByWorkspaceId.delete(input.workspaceId);
          return Effect.succeed(true);
        });
      }),
    withAdministrativeAccess: (workspaceIds, effect) => {
      return Effect.gen(function* () {
        const currentIds = yield* FiberRef.get(administrativeWorkspaceIds);
        const nextIds = new Set(currentIds);
        for (const workspaceId of workspaceIds) {
          nextIds.add(workspaceId);
        }
        return yield* effect.pipe(Effect.locally(administrativeWorkspaceIds, nextIds));
      });
    },
  };
};

const blockedWorkspaceError = (blocked: BlockedWorkspace): HostValidationError => {
  if (blocked.reason === "removal") {
    return new HostValidationError({
      message: `Workspace removal is incomplete for ${blocked.workspaceId}. Retry removal before accessing this workspace.`,
      field: "workspaceId",
    });
  }
  return new HostValidationError({
    message: `Workspace is closed: ${blocked.workspaceId}. Reopen it before using it.`,
    field: "workspaceId",
  });
};

const reservedWorkspaceError = (reservation: WorkspaceReservation): HostValidationError =>
  new HostValidationError({
    message: `A workspace ${reservation.operation} operation is already in progress for ${reservation.workspaceId}. Wait for it to finish and retry.`,
    field: "workspaceId",
  });
