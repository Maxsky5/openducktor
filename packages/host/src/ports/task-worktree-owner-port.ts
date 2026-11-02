import type { TaskWorktreeOwners } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { TaskStoreError } from "./task-repository-ports";

/**
 * How an owner read treats the saved Claude chats whose native history uses a worktree. `none`
 * skips the native metadata reads. `required` fails on the first chat whose history cannot be
 * read. `report` lists these chats in `historyReadErrors`, for a confirmation that only warns.
 */
export type HistoryOwnerRead = "none" | "required" | "report";

/** Reads who still needs the task worktrees that task cleanup removes. */
export type TaskWorktreeOwnerReader = {
  /** Reads the owners in every configured workspace, other than the tasks themselves. */
  readOwners(input: {
    workspaceId: string;
    repoPath: string;
    taskIds: readonly string[];
    worktreePaths: readonly string[];
    history: HistoryOwnerRead;
  }): Effect.Effect<TaskWorktreeOwners, HostError | TaskStoreError>;
};
