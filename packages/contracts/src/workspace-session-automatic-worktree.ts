import type { WorkspaceSession } from "./workspace-session-schemas";

/** The hexadecimal digits of the folder and the temporary branch of an unnamed chat worktree. */
const AUTOMATIC_NAME_LENGTH = 8;

/** The folder name of an unnamed chat worktree: the first digits of the session ID. */
export const automaticWorktreeName = (sessionId: string): string =>
  sessionId.replace(/-/g, "").slice(0, AUTOMATIC_NAME_LENGTH).toLowerCase();

/**
 * Tells whether a chat is an unnamed chat worktree before its first message: its folder and the
 * last segment of its branch are the automatic name of its session ID. The first message gives
 * such a branch its final name. The check ignores the branch prefix, because the prefix setting
 * can change after creation.
 */
export const hasAutomaticWorktreeBranch = (
  session: Pick<WorkspaceSession, "id" | "executionTarget" | "lastActivityAt">,
): boolean => {
  const target = session.executionTarget;
  if (target.kind !== "local_worktree" || target.branchName === null) return false;
  if (session.lastActivityAt !== undefined) return false;
  const name = automaticWorktreeName(session.id);
  return (
    target.workingDirectory.split(/[\\/]/).at(-1) === name &&
    target.branchName.split("/").at(-1) === name
  );
};
