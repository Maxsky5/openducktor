import { Effect, Exit } from "effect";
import type { WorkspaceHostOwnershipPort } from "../../ports/workspace-host-ownership-port";
import type { WorkspaceAdmissionService } from "./workspace-admission-service";

type ReservationInput = {
  operation: "close" | "reopen" | "remove";
  repoPath: string;
  workspaceId: string;
};

export const runWorkspaceLifecycleReservation = <A, E, R>(
  admission: Pick<WorkspaceAdmissionService, "releaseReservation" | "reserveWorkspace">,
  hostOwnership: Pick<WorkspaceHostOwnershipPort, "claimWorkspace" | "releaseWorkspace">,
  input: ReservationInput,
  use: () => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    admission.reserveWorkspace(input),
    () =>
      hostOwnership.claimWorkspace(input.workspaceId).pipe(
        Effect.flatMap((claimAcquired) =>
          input.operation === "reopen"
            ? Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                  const exit = yield* Effect.exit(restore(use()));
                  if (Exit.isFailure(exit) && claimAcquired) {
                    yield* hostOwnership.releaseWorkspace(input.workspaceId);
                  }
                  return yield* Exit.matchEffect(exit, {
                    onFailure: Effect.failCause,
                    onSuccess: Effect.succeed,
                  });
                }),
              )
            : use(),
        ),
      ),
    () => Effect.sync(() => admission.releaseReservation(input.workspaceId)),
  );
