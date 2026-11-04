import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";

/** The canonical path of a local Git repository, or an error that names the path. */
export const requireLocalGitRepository = (gitPort: GitPort, repoPath: string) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath).pipe(
      Effect.mapError(
        (cause) =>
          new HostValidationError({
            field: "repoPath",
            message: `Repository path is not accessible: ${repoPath}`,
            cause,
          }),
      ),
    );
    if (!(yield* gitPort.isGitRepository(canonicalRepoPath)))
      return yield* Effect.fail(
        new HostValidationError({
          field: "repoPath",
          message: `Not a git repository: ${canonicalRepoPath}`,
        }),
      );
    return canonicalRepoPath;
  });
