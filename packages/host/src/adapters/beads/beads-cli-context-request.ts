import { Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import type { ResolveBeadsCliContextRequestOptions } from "../../infrastructure/beads/beads-context-model";
import {
  beadsCliContextCacheKey,
  canonicalOrAbsolute,
} from "../../infrastructure/beads/beads-context-model";
import type { ResolveWorkspaceIdForRepoPath } from "../../infrastructure/beads/task-store/beads-raw-issue";
import type { TaskStoreError } from "../../ports/task-repository-ports";

export type BeadsCliContextRequest = {
  cacheKey: string;
  options: ResolveBeadsCliContextRequestOptions;
  repoPath: string;
};

export type CreateBeadsCliContextRequestResolverInput = {
  isClosing: () => boolean;
  resolveWorkspaceIdForRepoPath?: ResolveWorkspaceIdForRepoPath;
};

const closingError = () =>
  new HostResourceError({
    resource: "beadsTaskStore",
    operation: "beadsTaskRepository.resolveContextRequest",
    message: "Beads task store is closing.",
  });

export const createBeadsCliContextRequestResolver =
  ({ isClosing, resolveWorkspaceIdForRepoPath }: CreateBeadsCliContextRequestResolverInput) =>
  (
    repoPath: string,
    options: ResolveBeadsCliContextRequestOptions = {},
  ): Effect.Effect<BeadsCliContextRequest, TaskStoreError> =>
    Effect.gen(function* () {
      if (isClosing()) {
        return yield* Effect.fail(closingError());
      }

      const { workspaceId: requestedWorkspaceId, ...optionsWithoutWorkspaceId } = options;
      const configuredWorkspaceId =
        typeof requestedWorkspaceId === "string" && requestedWorkspaceId.trim().length > 0
          ? requestedWorkspaceId.trim()
          : null;
      const workspaceId = configuredWorkspaceId
        ? configuredWorkspaceId
        : resolveWorkspaceIdForRepoPath
          ? yield* resolveWorkspaceIdForRepoPath(repoPath)
          : null;

      if (isClosing()) {
        return yield* Effect.fail(closingError());
      }

      const normalizedWorkspaceId =
        typeof workspaceId === "string" && workspaceId.trim().length > 0
          ? workspaceId.trim()
          : null;
      const effectiveOptions = normalizedWorkspaceId
        ? { ...optionsWithoutWorkspaceId, workspaceId: normalizedWorkspaceId }
        : optionsWithoutWorkspaceId;
      const canonicalRepoPath = yield* canonicalOrAbsolute(repoPath);
      const cacheKey = beadsCliContextCacheKey({
        canonicalRepoPath,
        workspaceId: normalizedWorkspaceId,
      });
      return {
        cacheKey,
        options: effectiveOptions,
        repoPath: canonicalRepoPath,
      };
    });
