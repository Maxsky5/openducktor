import { speedEligibility } from "@openducktor/core";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type WorkspaceSession,
  type WorkspaceSessionRefInput,
  type AgentSessionModelSelection,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { WorkspaceSessionServiceDependencies } from "./workspace-session-service";
import type { createWorkspaceSessionRecordReader } from "./workspace-session-record-reader";

export const createWorkspaceSessionSpeed = (
  dependencies: Pick<WorkspaceSessionServiceDependencies, "catalog" | "store" | "operationGate">,
  recordFor: ReturnType<typeof createWorkspaceSessionRecordReader>["recordFor"],
) => {
  const { store, operationGate } = dependencies;
  const eligibilityFor = (
    repoPath: string,
    workingDirectory: string,
    runtimeKind: WorkspaceSession["runtimeKind"],
    model: WorkspaceSession["selectedModel"],
    speed: string,
  ) =>
    Effect.gen(function* () {
      const descriptor = RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind];
      if (descriptor.capabilities.speed.support === "none") return "unsupported" as const;
      const read = yield* dependencies.catalog
        .loadRuntimeCatalog({ repoPath, workingDirectory, runtimeKind })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HostOperationError({
                operation: "workspaceSession.speedCatalog",
                message: cause.message,
                cause,
              }),
          ),
        );
      if (!read.models || read.models.status === "failed")
        return yield* new HostValidationError({
          field: "speed",
          message:
            read.models?.status === "failed"
              ? read.models.message
              : "The runtime did not report a model catalog. Refresh the model list.",
        });
      return speedEligibility(descriptor, read.models.catalog, model, speed);
    });
  const requireSpeed = (
    repoPath: string,
    workingDirectory: string,
    runtimeKind: WorkspaceSession["runtimeKind"],
    model: WorkspaceSession["selectedModel"],
    speed: string,
  ) =>
    eligibilityFor(repoPath, workingDirectory, runtimeKind, model, speed).pipe(
      Effect.flatMap((eligibility) =>
        eligibility === "supported"
          ? Effect.void
          : Effect.fail(
              new HostValidationError({
                field: "speed",
                message:
                  "Speed requires a model with confirmed support. Select a supported model or select Standard.",
              }),
            ),
      ),
    );
  return {
    requireSpeed,
    setDraftModel: (
      input: WorkspaceSessionRefInput & { selectedModel: AgentSessionModelSelection },
    ) =>
      operationGate.run(
        input,
        Effect.gen(function* () {
          const { ref, session } = yield* recordFor(input);
          if (session.externalSessionId !== null || session.archivedAt !== null) {
            return yield* new HostValidationError({
              field: "sessionId",
              message: "Only an active draft can change its saved model.",
            });
          }
          const eligibility =
            session.speed !== null && session.speed !== "standard"
              ? yield* eligibilityFor(
                  ref.repoPath,
                  session.executionTarget.workingDirectory,
                  session.runtimeKind,
                  input.selectedModel,
                  session.speed,
                )
              : "unknown";
          return yield* store.setSelectedModel({
            ...ref,
            selectedModel: input.selectedModel,
            speed: eligibility === "unsupported" ? "standard" : session.speed,
          });
        }),
      ),
    setDraftSpeed: (input: WorkspaceSessionRefInput & { speed: string }) =>
      operationGate.run(
        input,
        Effect.gen(function* () {
          const { ref, session } = yield* recordFor(input);
          if (session.externalSessionId !== null || session.archivedAt !== null)
            return yield* new HostValidationError({
              field: "sessionId",
              message: "Only an active draft can change draft speed.",
            });
          if (input.speed !== "standard")
            yield* requireSpeed(
              ref.repoPath,
              session.executionTarget.workingDirectory,
              session.runtimeKind,
              session.selectedModel,
              input.speed,
            );
          return yield* store.setSpeed({ ...ref, speed: input.speed });
        }),
      ),
  };
};
