import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";

/** Resolves the runtime and repository that a runtime request names. */
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
