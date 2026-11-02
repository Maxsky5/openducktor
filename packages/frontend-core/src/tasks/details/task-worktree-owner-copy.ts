import type { WorktreeOwners } from "@openducktor/contracts";
import { describeWorktreeOwners, type WorktreeOwnerLine } from "@openducktor/core";
import type { TaskWorktreeOwnersRead } from "../../queries/use-task-worktree-owners";

/**
 * What a cleanup confirmation says about the others that need a worktree that it removes. A
 * Claude chat whose native history uses the worktree, or whose history the host could not read,
 * only warns.
 */
export const worktreeOwnerLines = (read: TaskWorktreeOwnersRead): WorktreeOwnerLine[] => [
  ...(read.owners ? describeWorktreeOwners(read.owners) : []),
  ...read.historyReadErrors.map((text) => ({ text, blocking: false })),
];

/** The text of a failed owner read, or null. It blocks the removal, which cannot run safely. */
export const worktreeOwnerReadErrorMessage = (read: TaskWorktreeOwnersRead): string | null =>
  read.error === null ? null : `Unable to check who else needs the worktree: ${read.error}`;

/** The owner read has its first result or error, so a confirmation can show its content. */
export const hasWorktreeOwnerReadResult = (read: TaskWorktreeOwnersRead): boolean =>
  read.owners !== null || read.error !== null;

/** True while the owner read runs, fails, or finds another workspace, task, or chat. */
export const isWorktreeOwnerReadBlocking = (read: TaskWorktreeOwnersRead): boolean =>
  read.isLoading || read.error !== null || worktreeOwnerLines(read).some((line) => line.blocking);

/** True while another workspace, task, or chat stops the cleanup. */
export const hasBlockingWorktreeOwners = (owners: WorktreeOwners | null): boolean =>
  owners !== null && describeWorktreeOwners(owners).some((line) => line.blocking);

/**
 * The color of an owner line in a cleanup choice. Only the color changes with the choice, so the
 * card keeps its size.
 */
export const worktreeOwnerLineTone = (
  line: WorktreeOwnerLine,
  removes: boolean,
): "muted" | "destructive" | "warning" => {
  if (!removes) return "muted";
  return line.blocking ? "destructive" : "warning";
};

/** A confirmation cannot run while its session check failed or its owner read blocks. */
export const isConfirmBlockedByImpact = (impact: {
  activeSessionCountError: string | null;
  worktreeOwners: TaskWorktreeOwnersRead;
}): boolean =>
  impact.activeSessionCountError !== null || isWorktreeOwnerReadBlocking(impact.worktreeOwners);
