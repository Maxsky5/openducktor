import { Effect } from "effect";
import {
  defaultRunBd,
  defaultRunBdJson,
} from "../../infrastructure/beads/task-store/beads-command-runner";
import type {
  ResolveBeadsCliContext,
  RunBd,
  RunBdJson,
} from "../../infrastructure/beads/task-store/beads-raw-issue";
import type { TaskStoreError } from "../../ports/task-repository-ports";

export type CreateBdCommandProviderInput = {
  resolveCliContext: ResolveBeadsCliContext;
  runBd?: RunBd;
  runBdJson?: RunBdJson;
};

export type BdCommandProvider = {
  runBdForRepo(repoPath: string): Effect.Effect<RunBd, TaskStoreError>;
  /** Raw JSON runner accepting optional context; runBdJsonForRepo returns a repo-bound runner. */
  runBdJson: RunBdJson;
  runBdJsonForRepo(repoPath: string): Effect.Effect<RunBdJson, TaskStoreError>;
};

export const createBdCommandProvider = ({
  resolveCliContext,
  runBd,
  runBdJson,
}: CreateBdCommandProviderInput): BdCommandProvider => {
  const effectiveRunBd = runBd ?? defaultRunBd(resolveCliContext);
  const effectiveRunBdJson = runBdJson ?? defaultRunBdJson(resolveCliContext);

  return {
    runBdForRepo(repoPath) {
      return Effect.gen(function* () {
        if (runBd) {
          return effectiveRunBd;
        }
        const context = yield* resolveCliContext(repoPath, { requireSharedServer: true });
        const boundRunBd: RunBd = (commandRepoPath, args, _callContext) =>
          effectiveRunBd(commandRepoPath, args, context);
        return boundRunBd;
      });
    },
    runBdJson: effectiveRunBdJson,
    runBdJsonForRepo(repoPath) {
      return Effect.gen(function* () {
        if (runBdJson) {
          return effectiveRunBdJson;
        }
        const context = yield* resolveCliContext(repoPath, { requireSharedServer: true });
        const boundRunBdJson: RunBdJson = (commandRepoPath, args, _callContext) =>
          effectiveRunBdJson(commandRepoPath, args, context);
        return boundRunBdJson;
      });
    },
  };
};
