import { Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import type {
  ResolveBeadsCliContextOptions,
  ResolveBeadsCliContextRequestOptions,
} from "../../infrastructure/beads/beads-context-model";
import type { ResolveWorkspaceIdForRepoPath } from "../../infrastructure/beads/task-store/beads-raw-issue";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { BeadsToolPaths, SharedDoltToolPaths } from "./beads-cli-context";

export type BeadsCliContextRequest = {
  cacheKey: string;
  options: ResolveBeadsCliContextOptions;
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

      const configuredWorkspaceId =
        typeof options.workspaceId === "string" && options.workspaceId.trim().length > 0
          ? options.workspaceId.trim()
          : null;
      const tools = yield* resolveBeadsToolPaths();
      const cliOptions: ResolveBeadsCliContextOptions =
        options.requireSharedServer === true
          ? {
              ...options,
              processEnv,
              requireSharedServer: true,
              sharedDoltTools: yield* resolveSharedDoltToolPaths(),
              tools,
            }
          : {
              ...options,
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
      const cacheKey = `${repoPath}\0${normalizedWorkspaceId ?? ""}`;
      return {
        cacheKey,
        options: effectiveOptions,
      };
    });
