import { Effect } from "effect";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";
import {
  loadTargetSession,
  type RuntimeOrchestratorService,
  resolveRepoPath,
  resolveRuntimeDescriptor,
} from "./runtime-orchestrator-model";

export type { RuntimeOrchestratorService } from "./runtime-orchestrator-model";

export const createRuntimeOrchestratorService = ({
  gitPort,
  runtimeDefinitionsService,
  runtimeRegistry,
  taskReader,
}: {
  gitPort: Pick<GitPort, "canonicalizePath" | "isGitRepository">;
  runtimeDefinitionsService: RuntimeDefinitionsService;
  runtimeRegistry: Pick<RuntimeRegistryPort, "stopSession">;
  taskReader: Pick<TaskReader, "getTaskMetadata">;
}): RuntimeOrchestratorService => ({
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
