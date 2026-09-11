import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  type HostOperationErrorAggregate,
  HostOperationError,
  type HostValidationErrorAggregate,
  HostValidationError,
} from "../../effect/host-errors";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export type WorkspaceBlockReason = "closed" | "removal";

export type WorkspaceAdmissionError = HostOperationErrorAggregate | HostValidationErrorAggregate;

type BlockedWorkspace = {
  repoPath: string;
  reason: WorkspaceBlockReason;
  workspaceId: string;
};

export type WorkspaceAdmissionService = {
  initialize(): Effect.Effect<void, HostOperationError>;
  isWorkspaceBlocked(workspaceId: string): boolean;
  assertTaskStoreAccess(input: {
    operation: string;
    repoPath: string;
    workspaceId: string;
  }): Effect.Effect<void, WorkspaceAdmissionError>;
  assertProcessStart(repoPath: string): Effect.Effect<void, WorkspaceAdmissionError>;
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

const MUTATING_TASK_STORE_OPERATION =
  /\.(clear|create|delete|promote|record|register|remove|set|transition|update|upsert)/i;

export const isMutatingTaskStoreOperation = (operation: string): boolean =>
  MUTATING_TASK_STORE_OPERATION.test(operation);

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

export const createWorkspaceAdmissionService = ({
  workspaceSettingsService,
}: {
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
}): WorkspaceAdmissionService => {
  const blockedByWorkspaceId = new Map<string, BlockedWorkspace>();
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

  const ensureInitialized = (): Effect.Effect<void, HostOperationError> =>
    initialized ? Effect.void : initialize();

  const assertTaskStoreAccess: WorkspaceAdmissionService["assertTaskStoreAccess"] = (input) =>
    ensureInitialized().pipe(
      Effect.flatMap(() => {
        if (administrativeWorkspaceIds.has(input.workspaceId)) {
          return Effect.void;
        }
        const blocked = blockedByWorkspaceId.get(input.workspaceId);
        if (!blocked) {
          return Effect.void;
        }
        if (blocked.reason === "removal" || isMutatingTaskStoreOperation(input.operation)) {
          return Effect.fail(blockedWorkspaceError(blocked));
        }
        return Effect.void;
      }),
    );

  const assertProcessStart: WorkspaceAdmissionService["assertProcessStart"] = (repoPath) =>
    ensureInitialized().pipe(
      Effect.flatMap(() => {
        const normalizedRepoPath = normalizePathForComparison(repoPath);
        const blocked = [...blockedByWorkspaceId.values()].find(
          (candidate) => normalizePathForComparison(candidate.repoPath) === normalizedRepoPath,
        );
        return blocked ? Effect.fail(blockedWorkspaceError(blocked)) : Effect.void;
      }),
    );

  return {
    initialize,
    isWorkspaceBlocked: (workspaceId) => blockedByWorkspaceId.has(workspaceId),
    assertTaskStoreAccess,
    assertProcessStart,
    blockWorkspace: (input) => {
      blockedByWorkspaceId.set(input.workspaceId, input);
    },
    unblockWorkspace: (workspaceId) => {
      blockedByWorkspaceId.delete(workspaceId);
    },
    forgetWorkspace: (workspaceId) => {
      blockedByWorkspaceId.delete(workspaceId);
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
