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
  resolveCliContext: ResolveBeadsCliContext;
  runBd: RunBd;
  runBdForRepo(repoPath: string): Effect.Effect<RunBd, TaskStoreError>;
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
    resolveCliContext,
    runBd: effectiveRunBd,
    runBdForRepo(repoPath) {
      return Effect.gen(function* () {
        if (runBd) {
          return effectiveRunBd;
        }
        const context = yield* resolveCliContext(repoPath, { requireSharedServer: true });
        return (commandRepoPath, args) => effectiveRunBd(commandRepoPath, args, context);
      });
    },
    runBdJson: effectiveRunBdJson,
    runBdJsonForRepo(repoPath) {
      return Effect.gen(function* () {
        if (runBdJson) {
          return effectiveRunBdJson;
        }
        const context = yield* resolveCliContext(repoPath, { requireSharedServer: true });
        return (commandRepoPath, args) => effectiveRunBdJson(commandRepoPath, args, context);
      });
    },
  };
};
