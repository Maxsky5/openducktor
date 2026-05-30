import { Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import type {
  ResolveBeadsCliContextOptions,
  ResolveBeadsCliContextRequestOptions,
} from "../../infrastructure/beads/beads-context-model";
import {
  beadsCliContextCacheKey,
  canonicalOrAbsolute,
} from "../../infrastructure/beads/beads-context-model";
import type { ResolveWorkspaceIdForRepoPath } from "../../infrastructure/beads/task-store/beads-raw-issue";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { BeadsToolPaths, SharedDoltToolPaths } from "./beads-cli-context";

export type BeadsCliContextRequest = {
  cacheKey: string;
  options: ResolveBeadsCliContextOptions;
  repoPath: string;
};

type ToolPathResolver<ToolPaths> = () => Effect.Effect<ToolPaths, TaskStoreError>;

export type CreateBeadsCliContextRequestResolverInput = {
  isClosing: () => boolean;
  processEnv: NodeJS.ProcessEnv;
  resolveBeadsToolPaths: ToolPathResolver<BeadsToolPaths>;
  resolveSharedDoltToolPaths: ToolPathResolver<SharedDoltToolPaths>;
  resolveWorkspaceIdForRepoPath?: ResolveWorkspaceIdForRepoPath;
};

const closingError = () =>
  new HostResourceError({
    resource: "beadsTaskStore",
    operation: "beadsTaskRepository.resolveContextRequest",
    message: "Beads task store is closing.",
  });

export const createBeadsCliContextRequestResolver =
  ({
    isClosing,
    processEnv,
    resolveBeadsToolPaths,
    resolveSharedDoltToolPaths,
    resolveWorkspaceIdForRepoPath,
  }: CreateBeadsCliContextRequestResolverInput) =>
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
      const tools = yield* resolveBeadsToolPaths();
      const cliOptions: ResolveBeadsCliContextOptions =
        optionsWithoutWorkspaceId.requireSharedServer === true
          ? {
              ...optionsWithoutWorkspaceId,
              processEnv,
              requireSharedServer: true,
              sharedDoltTools: yield* resolveSharedDoltToolPaths(),
              tools,
            }
          : {
              ...optionsWithoutWorkspaceId,
              processEnv,
              requireSharedServer: false,
              tools,
            };
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
        ? { ...cliOptions, workspaceId: normalizedWorkspaceId }
        : cliOptions;
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
