import type { AgentSessionStopTarget } from "@openducktor/contracts";
import { Effect } from "effect";
import { hasSameAgentSessionIdentity } from "../../domain/agent-session-identity";
import {
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { RuntimeRegistryError } from "../../ports/runtime-registry-port";
import type { TaskReader, TaskStoreError } from "../../ports/task-repository-ports";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";
export type RuntimeOrchestratorError =
  | GitPortError
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | RuntimeRegistryError
  | TaskStoreError;

export type RuntimeOrchestratorService = {
  agentSessionStop(input: AgentSessionStopTarget): Effect.Effect<
    {
      ok: boolean;
    },
    RuntimeOrchestratorError
  >;
};
export const resolveRuntimeDescriptor = (
  runtimeDefinitionsService: RuntimeDefinitionsService,
  runtimeKind: string,
) =>
  Effect.gen(function* () {
    const runtime = runtimeDefinitionsService
      .listRuntimeDefinitions()
      .find((definition) => definition.kind === runtimeKind);
    if (!runtime) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Unsupported runtime kind: ${runtimeKind}`,
          details: { runtimeKind },
        }),
      );
    }
    return runtime;
  });
export const resolveRepoPath = (
  gitPort: Pick<GitPort, "canonicalizePath" | "isGitRepository">,
  repoPath: string,
) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath).pipe(
      Effect.mapError(
        (error) =>
          new HostValidationError({
            field: "repoPath",
            message: `repoPath does not exist or is not accessible: ${repoPath}`,
            cause: error,
            details: { repoPath },
          }),
      ),
    );
    if (!(yield* gitPort.isGitRepository(canonicalRepoPath))) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "repoPath",
          message: `Not a git repository: ${canonicalRepoPath}`,
          details: { repoPath: canonicalRepoPath },
        }),
      );
    }
    return canonicalRepoPath;
  });
export const loadTargetSession = (
  taskReader: Pick<TaskReader, "getTaskMetadata">,
  repoPath: string,
  taskId: string,
  request: AgentSessionStopTarget,
) =>
  Effect.gen(function* () {
    const metadata = yield* taskReader.getTaskMetadata({ repoPath, taskId });
    const session = metadata.agentSessions.find((entry) =>
      hasSameAgentSessionIdentity(entry, request),
    );
    if (!session) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "session",
          message: `Agent session ${request.externalSessionId} (${request.runtimeKind}, ${request.workingDirectory}) was not found for task ${taskId}`,
          details: {
            repoPath,
            taskId,
            externalSessionId: request.externalSessionId,
            runtimeKind: request.runtimeKind,
            workingDirectory: request.workingDirectory,
          },
        }),
      );
    }
    return session;
  });
