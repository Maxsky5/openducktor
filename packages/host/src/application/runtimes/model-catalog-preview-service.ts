import type { AgentRuntimeCatalog, AgentRuntimePreviewModelsInput } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { Effect } from "effect";
import { errorMessage, type HostError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import { runtimeQueryError, type RuntimeQueryError } from "../../ports/runtime-query-error";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";
import { resolveRepoPath, resolveRuntimeDescriptor } from "./runtime-orchestrator-model";

export type ModelCatalogPreviewReader = (
  input: AgentRuntimePreviewModelsInput,
) => Effect.Effect<AgentModelCatalog, HostError>;

export const createModelCatalogPreviewService =
  ({
    gitPort,
    runtimeDefinitionsService,
    readModels,
  }: {
    gitPort: Pick<GitPort, "canonicalizePath" | "isGitRepository">;
    runtimeDefinitionsService: RuntimeDefinitionsService;
    readModels: ModelCatalogPreviewReader;
  }): ((
    input: AgentRuntimePreviewModelsInput,
  ) => Effect.Effect<AgentRuntimeCatalog, RuntimeQueryError>) =>
  (input) =>
    Effect.gen(function* () {
      const repoPath = yield* resolveRepoPath(gitPort, input.repoPath).pipe(
        Effect.mapError((cause) =>
          runtimeQueryError(
            "agent_runtime_preview_models",
            input,
            "scope_mismatch",
            cause.message,
            cause,
          ),
        ),
      );
      const runtime = yield* resolveRuntimeDescriptor(
        runtimeDefinitionsService,
        input.runtimeKind,
      ).pipe(
        Effect.mapError((cause) =>
          runtimeQueryError(
            "agent_runtime_preview_models",
            input,
            "runtime_unavailable",
            cause.message,
            cause,
          ),
        ),
      );
      const request = { repoPath, runtimeKind: input.runtimeKind };
      const catalog = yield* readModels(request).pipe(
        Effect.mapError((cause) =>
          runtimeQueryError(
            "agent_runtime_preview_models",
            request,
            "request_failed",
            errorMessage(cause),
            cause,
          ),
        ),
      );
      if (catalog.runtime?.kind !== input.runtimeKind) {
        return yield* runtimeQueryError(
          "agent_runtime_preview_models",
          request,
          "invalid_runtime_response",
          "The model catalog belongs to a different runtime. Reload the model list.",
        );
      }
      return { runtime, models: { status: "available" as const, catalog } };
    });
