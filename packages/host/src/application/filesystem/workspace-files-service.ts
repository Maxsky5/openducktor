import {
  type WorkspaceFileTree,
  type WorkspaceFileTreeRefreshInput,
  type WorkspaceFileTreeRefreshResult,
  type WorkspaceTextFileReadResult,
  type WorkspaceTextFileWriteInput,
  type WorkspaceTextFileWriteResult,
  workspaceFileTreeSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostValidationErrorAggregate } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { GitPort } from "../../ports/git-port";
import {
  canonicalizeWorkspaceRoot,
  loadWorkspaceFileEntries,
  workspaceFileValidationError,
} from "./workspace-file-access";
import { buildWorkspaceTree } from "./workspace-files-projection";
import { createWorkspaceTreeRefresh } from "./workspace-tree-refresh";
import {
  createWorkspaceTextFileService,
  type WorkspaceTextFileWriteError,
} from "./workspace-text-file-service";

export type WorkspaceFilesService = {
  dispose(): Effect.Effect<void>;
  refreshTree(
    input: WorkspaceFileTreeRefreshInput,
  ): Effect.Effect<WorkspaceFileTreeRefreshResult, HostValidationErrorAggregate>;
  listTree(input: {
    rootPath: string;
    targetBranch?: string;
  }): Effect.Effect<WorkspaceFileTree, HostValidationErrorAggregate>;
  readTextFile(input: {
    rootPath: string;
    relativePath: string;
  }): Effect.Effect<WorkspaceTextFileReadResult, HostValidationErrorAggregate>;
  writeTextFile(
    input: WorkspaceTextFileWriteInput,
  ): Effect.Effect<WorkspaceTextFileWriteResult, WorkspaceTextFileWriteError>;
};

export const createWorkspaceFilesService = (
  filesystem: FilesystemPort,
  gitPort: Pick<
    GitPort,
    | "getFileTreeContext"
    | "listFileRegions"
    | "getCurrentBranch"
    | "getRepositoryRoot"
    | "getStatus"
    | "isGitRepository"
    | "listChangedFiles"
    | "listFiles"
  >,
): WorkspaceFilesService => {
  const textFiles = createWorkspaceTextFileService(filesystem, gitPort);
  const refreshTree = createWorkspaceTreeRefresh(filesystem, gitPort);
  return {
    dispose: refreshTree.dispose,
    refreshTree,
    listTree(input) {
      return Effect.gen(function* () {
        const canonicalRoot = yield* canonicalizeWorkspaceRoot(filesystem, input.rootPath);
        const listedFiles = yield* loadWorkspaceFileEntries(gitPort, canonicalRoot);
        const repositoryRoot = yield* gitPort.getRepositoryRoot(canonicalRoot).pipe(
          Effect.mapError((cause) =>
            workspaceFileValidationError(
              cause,
              `Unable to resolve Git repository root for '${canonicalRoot}'.`,
              {
                rootPath: canonicalRoot,
              },
            ),
          ),
        );
        const targetChanges = input.targetBranch
          ? yield* gitPort.listChangedFiles(canonicalRoot, input.targetBranch).pipe(
              Effect.mapError((cause) =>
                workspaceFileValidationError(
                  cause,
                  `Unable to read Git diff for '${canonicalRoot}' against '${input.targetBranch}'.`,
                  {
                    rootPath: canonicalRoot,
                    targetBranch: input.targetBranch,
                  },
                ),
              ),
            )
          : [];
        const statuses = yield* gitPort.getStatus(canonicalRoot).pipe(
          Effect.mapError((cause) =>
            workspaceFileValidationError(
              cause,
              `Unable to read Git status for '${canonicalRoot}'.`,
              {
                rootPath: canonicalRoot,
              },
            ),
          ),
        );
        return workspaceFileTreeSchema.parse(
          yield* buildWorkspaceTree(
            filesystem,
            repositoryRoot,
            canonicalRoot,
            listedFiles,
            statuses,
            targetChanges,
          ),
        );
      });
    },
    readTextFile(input) {
      return textFiles.readTextFile(input);
    },
    writeTextFile(input) {
      return textFiles.writeTextFile(input);
    },
  };
};
