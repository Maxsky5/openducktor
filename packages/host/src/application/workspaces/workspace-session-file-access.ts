import type {
  GitReadContext,
  WorkspaceFileScope,
  WorkspaceSessionRefInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { WorkspaceFilesService } from "../filesystem/workspace-files-service";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import {
  createWorkspaceSessionRecordReader,
  type WorkspaceSessionRecordReaderDependencies,
} from "./workspace-session-record-reader";
import {
  validateWorkspaceSessionTarget,
  type WorkspaceSessionTargetValidationDependencies,
} from "./workspace-session-target";

export type WorkspaceSessionFileAccessDependencies = WorkspaceSessionRecordReaderDependencies &
  WorkspaceSessionTargetValidationDependencies & {
    settingsConfig: Pick<SettingsConfigPort, "pathExists">;
    worktreeFiles: Pick<WorktreeFilePort, "resolveWorktreeRemovalPath">;
    lifecycle: Pick<TaskSessionLifecycleCoordinator, "runWorktreeRead">;
  };

/**
 * Runs a file request of a chat while its saved directory is a checkout of its workspace.
 * The read guard keeps archive from removing the directory during the request. A chat keeps its
 * directory path for its whole life, so the checks after the wait use the record read before it.
 * A tree refresh and a read during a refresh send their read context, so they share Git reads
 * with the Git panel. A save checks again, because it must check the directory at write time.
 */
export const createWorkspaceSessionFileAccess = (
  dependencies: WorkspaceSessionFileAccessDependencies,
) => {
  const { recordFor } = createWorkspaceSessionRecordReader(dependencies);
  return <A, E>(
    ref: WorkspaceSessionRefInput,
    rootPath: string,
    use: Effect.Effect<A, E>,
    readContext?: GitReadContext,
  ) =>
    Effect.gen(function* () {
      const { ref: chatRef, session } = yield* recordFor(ref);
      const target = session.executionTarget;
      const directory = target.workingDirectory;
      const guardPath = yield* dependencies.worktreeFiles.resolveWorktreeRemovalPath(directory);
      return yield* dependencies.lifecycle.runWorktreeRead(
        guardPath,
        Effect.gen(function* () {
          if (!(yield* dependencies.settingsConfig.pathExists(directory))) {
            return yield* invalidRoot(
              target.kind === "local_repo_root"
                ? `The repository of this chat is missing: ${directory}. Restore the repository at this path, or archive this chat.`
                : `The directory of this chat is missing: ${directory}. Recreate the worktree at this path, or archive this chat.`,
            );
          }
          const canonicalDirectory = yield* validateWorkspaceSessionTarget(
            dependencies,
            chatRef.repoPath,
            target,
            readContext,
          );
          if ((yield* dependencies.git.canonicalizePath(rootPath)) !== canonicalDirectory) {
            return yield* invalidRoot(
              `${rootPath} is not the directory of this chat: ${directory}. Reopen the chat and retry.`,
            );
          }
          return yield* use;
        }),
      );
    });
};

export type WorkspaceSessionFileAccess = ReturnType<typeof createWorkspaceSessionFileAccess>;

/** Sends each file request of a chat through the chat directory check. */
export const scopeFilesToChats = (
  files: WorkspaceFilesService,
  access: WorkspaceSessionFileAccess,
): WorkspaceFilesService<HostError | TaskStoreError> => {
  const forChat = <A, E>(
    input: { rootPath: string; scope?: WorkspaceFileScope | undefined },
    use: Effect.Effect<A, E>,
    readContext?: GitReadContext,
  ) =>
    input.scope?.kind === "chat"
      ? access(input.scope.session, input.rootPath, use, readContext)
      : use;
  return {
    ...files,
    refreshTree: (input) =>
      forChat(input, files.refreshTree(input), { refreshId: input.refreshId }),
    readTextFile: (input) => forChat(input, files.readTextFile(input), input.readContext),
    writeTextFile: (input) => forChat(input, files.writeTextFile(input)),
  };
};

const invalidRoot = (message: string) => new HostValidationError({ field: "rootPath", message });
