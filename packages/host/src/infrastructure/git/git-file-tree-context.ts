import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import type { WorkspaceFileTreeContext } from "@openducktor/contracts";
import { z } from "zod";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import { type GitCommandRunner, runGit, runGitAllowFailure } from "./git-command-runner";
import { getCurrentBranchUnchecked } from "./git-status";

export const readFileTreeContext = (
  runner: GitCommandRunner,
  rootPath: string,
  targetBranch?: string,
) =>
  Effect.gen(function* () {
    const [gitDirectory, branch, targetRevision, enabled, cone, sparse, indexVersion] =
      yield* Effect.all(
        [
          runGit(runner, rootPath, ["rev-parse", "--absolute-git-dir"]).pipe(
            Effect.flatMap((output) =>
              Effect.tryPromise({
                try: () => realpath(output.trim()),
                catch: (cause) => toHostOperationError(cause, "git.fileTreeContext"),
              }),
            ),
          ),
          getCurrentBranchUnchecked(runner, rootPath),
          targetBranch
            ? runGit(runner, rootPath, [
                "rev-parse",
                "--verify",
                "--end-of-options",
                `${targetBranch}^{commit}`,
              ]).pipe(Effect.map((output) => output.trim()))
            : Effect.succeed(null),
          sparseSetting(runner, rootPath, "core.sparseCheckout"),
          sparseSetting(runner, rootPath, "core.sparseCheckoutCone"),
          sparseRules(runner, rootPath),
          readIndexVersion(runner, rootPath),
        ],
        { concurrency: "unbounded" },
      );
    return {
      rootPath,
      gitDirectory,
      branch: branch.name ?? null,
      head: branch.revision ?? null,
      targetBranch: targetBranch ?? null,
      targetRevision,
      indexVersion,
      sparsePolicy: createHash("sha256")
        .update(JSON.stringify([enabled, cone, sparse]))
        .digest("hex"),
    } satisfies WorkspaceFileTreeContext;
  });

const readIndexVersion = (runner: GitCommandRunner, root: string) =>
  Effect.gen(function* () {
    const indexPath = (yield* runGit(runner, root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ])).trim();
    return yield* Effect.tryPromise({
      try: async () => {
        try {
          const version = await stat(indexPath, { bigint: true });
          return [version.ino, version.size, version.mtimeNs, version.ctimeNs].join(":");
        } catch (cause) {
          // A new repository has no index until its first staged file.
          if (z.object({ code: z.literal("ENOENT") }).safeParse(cause).success) return null;
          throw cause;
        }
      },
      catch: (cause) => toHostOperationError(cause, "git.readIndexVersion"),
    });
  });

const sparseSetting = (runner: GitCommandRunner, root: string, name: string) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, root, ["config", "--get", name]);
    if (!result.ok && result.exitCode !== 1)
      return yield* new HostOperationError({
        operation: "git.fileTreeContext",
        message: result.stderr,
      });
    return result.stdout.trim();
  });
const sparseRules = (runner: GitCommandRunner, root: string) =>
  Effect.gen(function* () {
    const sparsePath = (yield* runGit(runner, root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "info/sparse-checkout",
    ])).trim();
    return yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(sparsePath, "utf8");
        } catch (cause) {
          if (z.object({ code: z.literal("ENOENT") }).safeParse(cause).success) return "";
          throw cause;
        }
      },
      catch: (cause) => toHostOperationError(cause, "git.readSparsePolicy"),
    });
  });
