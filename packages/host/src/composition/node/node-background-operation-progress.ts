import {
  backgroundOperationTargetSchema,
  workspaceRefSchema,
  workspaceSessionRefInputSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import {
  createBackgroundOperationProgress,
  CurrentBackgroundOperation,
  operationFailure,
  rememberBackgroundOperationFailure,
} from "../../application/operation-progress/background-operation-progress";
import { getScopedRepoConfig } from "../../application/workspaces/scoped-repo-config";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { causeToHostBoundaryError, HostValidationError } from "../../effect/host-errors";
import { createHostOperationWorkers } from "../../effect/host-operation-workers";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { HostCommandArgs } from "../../interface/commands/command-inputs";

const taskScopeSchema = z.object({
  ...workspaceRefSchema.shape,
  taskId: z.string().trim().min(1),
});
const chatScopeSchema = z.object(workspaceSessionRefInputSchema.shape);

export const createNodeBackgroundOperationTracker = ({
  hostInstanceId,
  eventBus,
  settings,
}: {
  hostInstanceId: string;
  eventBus: HostEventBusPort | undefined;
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
}) => {
  const workers = createHostOperationWorkers();
  const running = new Set<string>();
  return {
    shutdown: workers.shutdown,
    track: <A, E>(
      command: string,
      args: HostCommandArgs,
      operationId: string,
      work: Effect.Effect<A, E>,
    ) =>
      workers.run(
        Effect.gen(function* () {
          const parsed = yield* Effect.try({
            try: () =>
              command === "workspace_session_archive"
                ? chatScopeSchema.parse(args)
                : taskScopeSchema.parse(args),
            catch: (cause) =>
              new HostValidationError({
                field: "operationId",
                message: `Invalid target for ${command}. ${cause instanceof Error ? cause.message : ""}`,
                cause,
              }),
          });
          const config = yield* "taskId" in parsed
            ? getScopedRepoConfig(settings, parsed)
            : settings.getRepoConfig(parsed.workspaceId);
          const target = backgroundOperationTargetSchema.parse(
            "taskId" in parsed
              ? { kind: "task", taskId: parsed.taskId }
              : { kind: "chat", sessionId: parsed.sessionId },
          );
          const workspace = { workspaceId: config.workspaceId, repoPath: config.repoPath };
          const key = JSON.stringify([workspace.workspaceId, target]);
          if (running.has(key))
            return yield* new HostValidationError({
              field: "operationId",
              message: "An operation is running for this target. Wait for it to finish.",
            });

          const progress = createBackgroundOperationProgress(
            { operationId, hostInstanceId, workspace, target },
            (payload) =>
              eventBus?.publish({
                channel: "openducktor://background-operation-progress",
                payload,
              }),
          );
          running.add(key);
          return yield* Effect.gen(function* () {
            const result = yield* Effect.exit(
              work.pipe(Effect.provideService(CurrentBackgroundOperation, progress)),
            );
            if (result._tag === "Success") {
              progress.settle();
              return result.value;
            }
            const failure = causeToHostBoundaryError(result.cause);
            rememberBackgroundOperationFailure(
              failure,
              progress.settle(operationFailure(command, failure)),
            );
            return yield* Effect.fail(failure);
          }).pipe(Effect.ensuring(Effect.sync(() => running.delete(key))));
        }),
      ),
  };
};
