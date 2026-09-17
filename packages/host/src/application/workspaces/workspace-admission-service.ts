import { Effect, FiberRef } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  HostOperationError,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export type WorkspaceBlockReason = "closed" | "removal";

export type WorkspaceReservationOperation = "close" | "reopen" | "remove";

export type WithProcessStartAdmission = <A, E, R>(
  repoPath: string,
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E | HostValidationErrorAggregate, R>;

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

export type WorkspaceAdmissionService = {
  initialize(): Effect.Effect<void, HostOperationError>;
  isWorkspaceBlocked(workspaceId: string): boolean;
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
  withProcessStartAdmission: WithProcessStartAdmission;
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
  workspaceSettingsService,
}: {
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
}): WorkspaceAdmissionService => {
  const blockedByWorkspaceId = new Map<string, BlockedWorkspace>();
  const reservationsByWorkspaceId = new Map<string, WorkspaceReservation>();
  const activeProcessStartsByRepoPath = new Map<string, number>();
  const administrativeWorkspaceIds = FiberRef.unsafeMake<ReadonlySet<string>>(new Set());
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
      Effect.zipRight(FiberRef.get(administrativeWorkspaceIds)),
      Effect.flatMap((administrativeAccess) => {
        if (administrativeAccess.has(input.workspaceId)) {
          return Effect.void;
        }
        const reservation = reservationsByWorkspaceId.get(input.workspaceId);
        if (reservation) {
          return Effect.fail(reservedWorkspaceError(reservation));
        }
        const blocked = blockedByWorkspaceId.get(input.workspaceId);
        return blocked ? Effect.fail(blockedWorkspaceError(blocked)) : Effect.void;
      }),
    );

  const processStartError = (normalizedRepoPath: string): HostValidationError | null => {
    const reservation = [...reservationsByWorkspaceId.values()].find(
      (candidate) => normalizePathForComparison(candidate.repoPath) === normalizedRepoPath,
    );
    if (reservation) {
      return reservedWorkspaceError(reservation);
    }
    const blocked = [...blockedByWorkspaceId.values()].find(
      (candidate) => normalizePathForComparison(candidate.repoPath) === normalizedRepoPath,
    );
    return blocked ? blockedWorkspaceError(blocked) : null;
  };

  const withProcessStartAdmission: WithProcessStartAdmission = (repoPath, effect) =>
    Effect.acquireUseRelease(
      ensureInitialized().pipe(
        Effect.flatMap(() =>
          Effect.suspend(() => {
            const normalizedRepoPath = normalizePathForComparison(repoPath);
            const error = processStartError(normalizedRepoPath);
            if (error) {
              return Effect.fail(error);
            }
            activeProcessStartsByRepoPath.set(
              normalizedRepoPath,
              (activeProcessStartsByRepoPath.get(normalizedRepoPath) ?? 0) + 1,
            );
            return Effect.succeed(normalizedRepoPath);
          }),
        ),
      ),
      () => effect,
      (normalizedRepoPath) =>
        Effect.sync(() => {
          const remaining = (activeProcessStartsByRepoPath.get(normalizedRepoPath) ?? 1) - 1;
          if (remaining === 0) {
            activeProcessStartsByRepoPath.delete(normalizedRepoPath);
          } else {
            activeProcessStartsByRepoPath.set(normalizedRepoPath, remaining);
          }
        }),
    );

  return {
    initialize,
    isWorkspaceBlocked: (workspaceId) => blockedByWorkspaceId.has(workspaceId),
    reserveWorkspace: (input) =>
      Effect.suspend(() => {
        const existing = reservationsByWorkspaceId.get(input.workspaceId);
        if (existing) {
          return Effect.fail(reservedWorkspaceError(existing));
        }
        const normalizedRepoPath = normalizePathForComparison(input.repoPath);
        if ((activeProcessStartsByRepoPath.get(normalizedRepoPath) ?? 0) > 0) {
          return Effect.fail(
            new HostValidationError({
              message: `A process is starting for ${input.workspaceId}. Wait for it to finish and retry.`,
              field: "workspaceId",
            }),
          );
        }
        reservationsByWorkspaceId.set(input.workspaceId, input);
        return Effect.void;
      }),
    releaseReservation: (workspaceId) => {
      reservationsByWorkspaceId.delete(workspaceId);
    },
    assertTaskStoreAccess,
    withProcessStartAdmission,
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
    },
    withAdministrativeAccess: (workspaceId, effect) =>
      FiberRef.get(administrativeWorkspaceIds).pipe(
        Effect.flatMap((current) =>
          effect.pipe(
            Effect.locally(administrativeWorkspaceIds, new Set([...current, workspaceId])),
          ),
        ),
      ),
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
