import {
  type AgentSessionForkPoint,
  type WorkspaceSession,
  type WorkspaceSessionForkInput,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionForkInputSchema,
} from "@openducktor/contracts";
import { basenameForPath } from "@openducktor/path-support";
import { newWorktreeBranchState } from "../create/workspace-session-worktree-rules";

/** Where the forked chat works: the folder of the source chat, or a new worktree. */
export type WorkspaceSessionForkDestination = WorkspaceSessionForkInput["destination"]["kind"];

/** The words of the Fork chat form. Each client renders them with its own controls. */
export const FORK_CHAT_TEXT = {
  title: "Fork chat",
  description: "Copy the conversation through this reply, then choose where the new chat works.",
  locationLabel: "Fork work location",
  sameFolder: "Same folder",
  sameFolderDescription: "Work with the files already here.",
  newWorktree: "New worktree",
  newWorktreeDescription: "Start from the last commit in the source folder.",
  sourceFolder: "Source folder",
  uncommittedChanges: "Uncommitted changes in the source folder do not go to the new worktree.",
  confirm: "Fork chat",
  confirming: "Forking chat…",
  forkedWithWarning: "The fork was created",
} as const;

/** The folder that the source chat works in, as the form shows it. */
export const forkSourceFolder = (record: WorkspaceSession) => {
  const directory = record.executionTarget.workingDirectory;
  return {
    name: basenameForPath(directory) || directory,
    directory,
    branchName:
      record.executionTarget.kind === "local_worktree" ? record.executionTarget.branchName : null,
  };
};

/** A fork of a worktree chat suggests the name of its folder with a `-fork` suffix. */
export const initialForkWorktree = (record: WorkspaceSession): WorkspaceSessionWorktreeInput => ({
  mode: "from_name",
  name:
    record.executionTarget.kind === "local_worktree" ? `${forkSourceFolder(record).name}-fork` : "",
  branchName: null,
});

/**
 * The fork request of the form, or null while a field is not valid. A new worktree without a
 * branch name takes the default branch of the repository prefix.
 */
export const workspaceSessionForkInput = ({
  workspaceId,
  record,
  point,
  destination,
  worktree,
  branchPrefix,
}: {
  workspaceId: string;
  record: WorkspaceSession;
  point: AgentSessionForkPoint;
  destination: WorkspaceSessionForkDestination;
  worktree: WorkspaceSessionWorktreeInput;
  branchPrefix: string | undefined;
}): WorkspaceSessionForkInput | null => {
  const parsed = workspaceSessionForkInputSchema.safeParse({
    workspaceId,
    sessionId: record.id,
    forkPoint: point,
    destination:
      destination === "same_folder"
        ? { kind: "same_folder" }
        : {
            kind: "new_worktree",
            name: worktree.name,
            branchName:
              worktree.branchName || newWorktreeBranchState(worktree, branchPrefix).defaultBranch,
          },
  });
  return parsed.success ? parsed.data : null;
};
