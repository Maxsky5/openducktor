import { Effect } from "effect";
import type { HostValidationErrorAggregate } from "../../effect/host-errors";
import { TaskAssetError, taskAssetValidationError } from "../../effect/task-asset-error";
import type { TaskAssetStagingService } from "./task-asset-staging-service";

export type TaskAssetWorkspaceAdmission = {
  assertWorkspaceAdmitsWork(repoPath: string): Effect.Effect<void, HostValidationErrorAggregate>;
  withWorkStartLease<A, E, R>(
    repoPath: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostValidationErrorAggregate, R>;
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toTaskAssetError = (cause: unknown): TaskAssetError =>
  cause instanceof TaskAssetError ? cause : taskAssetValidationError(messageOf(cause));

export const withTaskAssetWorkspaceAdmission = ({
  admission,
  resolveRepoPath,
  service,
}: {
  admission: TaskAssetWorkspaceAdmission;
  resolveRepoPath: (workspaceId: string) => Effect.Effect<string, unknown>;
  service: TaskAssetStagingService;
}): TaskAssetStagingService => ({
  ...service,
  stage: (input) =>
    resolveRepoPath(input.workspaceId).pipe(
      Effect.mapError((cause) => taskAssetValidationError(messageOf(cause))),
      Effect.flatMap((repoPath) =>
        admission
          .withWorkStartLease(
            repoPath,
            admission
              .assertWorkspaceAdmitsWork(repoPath)
              .pipe(Effect.zipRight(service.stage(input))),
          )
          .pipe(Effect.mapError(toTaskAssetError)),
      ),
    ),
});
