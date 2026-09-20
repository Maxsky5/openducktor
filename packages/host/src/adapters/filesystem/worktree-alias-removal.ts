import { lstat, readlink, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  HostValidationError,
  hasNestedNodeErrorCode,
  toHostOperationError,
} from "../../effect/host-errors";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";

export const prepareWorktreeAliasRemoval: WorktreeFilePort["prepareWorktreeAliasRemoval"] = (
  aliasPath,
  canonicalWorktreePath,
) =>
  Effect.gen(function* () {
    const aliasEntryPath = path.resolve(aliasPath);
    const stats = yield* Effect.tryPromise({
      try: () => lstat(aliasEntryPath),
      catch: (cause) => toHostOperationError(cause, "worktreeFile.inspectAlias", { aliasPath }),
    });
    // A symlink in a parent directory needs no cleanup at the worktree path.
    if (!stats.isSymbolicLink()) return { remove: Effect.void };
    const linkTarget = yield* Effect.tryPromise({
      try: () => readlink(aliasEntryPath),
      catch: (cause) => toHostOperationError(cause, "worktreeFile.readAlias", { aliasPath }),
    });
    const resolved = yield* Effect.tryPromise({
      try: () => realpath(aliasEntryPath),
      catch: (cause) => toHostOperationError(cause, "worktreeFile.resolveAlias", { aliasPath }),
    });
    if (resolved !== canonicalWorktreePath) {
      return yield* new HostValidationError({
        field: "workingDirectory",
        message: `Worktree alias ${aliasPath} changed. Reopen Archive chat before removing it.`,
      });
    }
    return {
      remove: Effect.gen(function* () {
        const currentTarget = yield* Effect.tryPromise({
          try: () => readlink(aliasEntryPath),
          catch: (cause) => toHostOperationError(cause, "worktreeFile.recheckAlias", { aliasPath }),
        }).pipe(
          Effect.catchAll((error) =>
            hasNestedNodeErrorCode(error, "ENOENT") ? Effect.succeed(null) : Effect.fail(error),
          ),
        );
        if (currentTarget === null) return;
        if (currentTarget !== linkTarget) {
          return yield* new HostValidationError({
            field: "workingDirectory",
            message: `Worktree alias ${aliasPath} changed during removal. Inspect the alias before retrying archive.`,
          });
        }
        const worktreeExists = yield* Effect.tryPromise({
          try: () => lstat(canonicalWorktreePath),
          catch: (cause) =>
            toHostOperationError(cause, "worktreeFile.checkRemovedWorktree", {
              canonicalWorktreePath,
            }),
        }).pipe(
          Effect.as(true),
          Effect.catchAll((error) =>
            hasNestedNodeErrorCode(error, "ENOENT") ? Effect.succeed(false) : Effect.fail(error),
          ),
        );
        if (worktreeExists) {
          return yield* new HostValidationError({
            field: "workingDirectory",
            message: `Worktree ${canonicalWorktreePath} still exists. Inspect it before removing alias ${aliasPath}.`,
          });
        }
        yield* Effect.tryPromise({
          try: () => unlink(aliasEntryPath),
          catch: (cause) => toHostOperationError(cause, "worktreeFile.removeAlias", { aliasPath }),
        });
      }),
    };
  });
