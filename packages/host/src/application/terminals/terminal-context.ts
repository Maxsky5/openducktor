import type { TerminalContext } from "@openducktor/contracts";

export type TerminalTaskScope = {
  repoPath: string;
  taskIds: readonly string[];
};

export const terminalContextKey = (context: TerminalContext): string =>
  "taskId" in context ? JSON.stringify([context.repoPath, context.taskId]) : "__unassociated__";

export const terminalContextMatchesTaskScope = (
  context: TerminalContext,
  scope: TerminalTaskScope,
): boolean =>
  "taskId" in context &&
  context.repoPath === scope.repoPath &&
  scope.taskIds.includes(context.taskId);
