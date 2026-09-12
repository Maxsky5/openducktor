import { Deferred, Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  HostOperationError,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

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
  awaitWorkStarts(repoPath: string): Effect.Effect<void, HostValidationErrorAggregate>;
  withWorkStartLease<A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R>;
  blockWorkspace(input: {
    reason: WorkspaceBlockReason;
    repoPath: string;
    workspaceId: string;
  }): void;
  unblockWorkspace(workspaceId: string): void;
  forgetWorkspace(workspaceId: string): void;
  withAdministrativeAccess<A, E, R>(
    workspaceId: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>;
};

export const createWorkspaceAdmissionService = ({
  settingsConfig,
  workspaceSettingsService,
}: {
  settingsConfig: Pick<SettingsConfigPort, "canonicalizePath">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
}): WorkspaceAdmissionService => {
  const blockedByWorkspaceId = new Map<string, BlockedWorkspace>();
  const reservationsByWorkspaceId = new Map<string, WorkspaceReservation>();
  const workStartsByRepoPath = new Map<string, WorkStartState>();
  const administrativeWorkspaceIds = new Set<string>();
  let initialized = false;

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

  const assertTaskStoreAccess: WorkspaceAdmissionService["assertTaskStoreAccess"] = (input) =>
    ensureInitialized().pipe(
      Effect.flatMap(() => {
        if (administrativeWorkspaceIds.has(input.workspaceId)) {
          return Effect.void;
        }
        const reservation = reservationsByWorkspaceId.get(input.workspaceId);
        if (reservation) {
          if (
            reservation.operation === "remove" ||
            reservation.operation === "reopen" ||
            isTaskStoreWriteOperation(input.operation)
          ) {
            return Effect.fail(reservedWorkspaceError(reservation));
          }
          return Effect.void;
        }
        const blocked = blockedByWorkspaceId.get(input.workspaceId);
        if (!blocked) {
          return Effect.void;
        }
        if (blocked.reason === "removal" || isTaskStoreWriteOperation(input.operation)) {
          return Effect.fail(blockedWorkspaceError(blocked));
        }
        return Effect.void;
      }),
    );

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
        const blocked = [...blockedByWorkspaceId.values()].find(
          (candidate) => normalizePathForComparison(candidate.repoPath) === key,
        );
        return blocked ? Effect.fail(blockedWorkspaceError(blocked)) : Effect.void;
      }),
    );

  const assertWorkspaceAdmitsWork: WorkspaceAdmissionService["assertWorkspaceAdmitsWork"] = (
    repoPath,
  ) => canonicalRepoPathKey(repoPath).pipe(Effect.flatMap(assertCanonicalWorkspaceAdmitsWork));

  const withWorkStartLease: WorkspaceAdmissionService["withWorkStartLease"] = (repoPath, effect) =>
    Effect.gen(function* () {
      const key = yield* canonicalRepoPathKey(repoPath);
      return yield* Effect.acquireUseRelease(
        Effect.suspend(() => {
          const state = workStartsByRepoPath.get(key) ?? { active: 0, drained: null };
          state.active += 1;
          workStartsByRepoPath.set(key, state);
          return Effect.void;
        }),
        () => Effect.zipRight(assertCanonicalWorkspaceAdmitsWork(key), effect),
        () =>
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
          }),
      );
    });

  const awaitWorkStarts: WorkspaceAdmissionService["awaitWorkStarts"] = (repoPath) =>
    canonicalRepoPathKey(repoPath).pipe(
      Effect.flatMap((key) =>
        Effect.gen(function* () {
          const state = workStartsByRepoPath.get(key);
          if (!state || state.active === 0) {
            return;
          }
          const waiter = state.drained ?? (yield* Deferred.make<void>());
          state.drained = waiter;
          yield* Deferred.await(waiter);
        }),
      ),
    );

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
    awaitWorkStarts,
    withWorkStartLease,
    blockWorkspace: (input) => {
      blockedByWorkspaceId.set(input.workspaceId, input);
    },
    unblockWorkspace: (workspaceId) => {
      blockedByWorkspaceId.delete(workspaceId);
      reservationsByWorkspaceId.delete(workspaceId);
    },
    forgetWorkspace: (workspaceId) => {
      blockedByWorkspaceId.delete(workspaceId);
      reservationsByWorkspaceId.delete(workspaceId);
      administrativeWorkspaceIds.delete(workspaceId);
    },
    withAdministrativeAccess: (workspaceId, effect) =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          administrativeWorkspaceIds.add(workspaceId);
        }),
        () => effect,
        () =>
          Effect.sync(() => {
            administrativeWorkspaceIds.delete(workspaceId);
          }),
      ),
  };
};

// Adapter operation names. Only these change stored task data.
const TASK_STORE_WRITE_OPERATION =
  /\.(clear|create|delete|promote|record|register|remove|set|transition|update|upsert)/i;

const isTaskStoreWriteOperation = (operation: string): boolean =>
  TASK_STORE_WRITE_OPERATION.test(operation);

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
