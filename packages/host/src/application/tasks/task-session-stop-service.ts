import type { AgentSessionStopTarget } from "@openducktor/contracts";
import { Effect } from "effect";
import { hasSameAgentSessionIdentity } from "../../domain/agent-session-identity";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskReader, TaskStoreError } from "../../ports/task-repository-ports";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import { resolveRepoPath, resolveRuntimeDescriptor } from "../runtimes/runtime-request-resolution";

export type TaskSessionStopError = GitPortError | HostError | TaskStoreError;

export type TaskSessionStopService = {
  /** Stops the native session of one task session in its shared runtime. */
  agentSessionStop(
    input: AgentSessionStopTarget,
  ): Effect.Effect<{ ok: boolean }, TaskSessionStopError>;
};

const loadTargetSession = (
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

export const createTaskSessionStopService = ({
  gitPort,
  runtimeDefinitionsService,
  runtimeRegistry,
  taskReader,
}: {
  gitPort: Pick<GitPort, "canonicalizePath" | "isGitRepository">;
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeRegistry: Pick<RuntimeRegistryPort, "stopSession">;
  taskReader: Pick<TaskReader, "getTaskMetadata">;
}): TaskSessionStopService => ({
  agentSessionStop(input) {
    return Effect.gen(function* () {
      yield* resolveRuntimeDescriptor(runtimeDefinitionsService, input.runtimeKind);
      const repoPath = yield* resolveRepoPath(gitPort, input.repoPath);
      const session = yield* loadTargetSession(taskReader, repoPath, input.taskId, input);
      yield* runtimeRegistry.stopSession({
        runtimeKind: input.runtimeKind,
        externalSessionId: session.externalSessionId,
        workingDirectory: session.workingDirectory,
      });
      return { ok: true };
    });
  },
});
