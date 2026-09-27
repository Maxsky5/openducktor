import type { TerminalContext } from "@openducktor/contracts";

export type TerminalTaskScope = {
  repoPath: string;
  taskIds: readonly string[];
};

export type TerminalWorkspaceSessionScope = { workspaceId: string; sessionId: string };

export const isTaskTerminalContext = (
  context: TerminalContext,
): context is Extract<TerminalContext, { taskId: string }> => "taskId" in context;

export const isWorkspaceSessionTerminalContext = (
  context: TerminalContext,
): context is Extract<TerminalContext, { kind: "workspace_session" }> =>
  "kind" in context && context.kind === "workspace_session";

export const terminalContextKey = (context: TerminalContext): string =>
  "taskId" in context
    ? JSON.stringify([context.repoPath, context.taskId])
    : isWorkspaceSessionTerminalContext(context)
      ? terminalWorkspaceSessionKey(context)
      : "__unassociated__";

export const terminalWorkspaceSessionKey = (scope: TerminalWorkspaceSessionScope): string =>
  JSON.stringify(["workspace_session", scope.workspaceId, scope.sessionId]);

export const terminalContextMatchesWorkspaceSession = (
  context: TerminalContext,
  scope: TerminalWorkspaceSessionScope,
): boolean =>
  isWorkspaceSessionTerminalContext(context) &&
  context.workspaceId === scope.workspaceId &&
  context.sessionId === scope.sessionId;

export const terminalContextMatchesTaskScope = (
  context: TerminalContext,
  scope: TerminalTaskScope,
): boolean =>
  "taskId" in context &&
  context.repoPath === scope.repoPath &&
  scope.taskIds.includes(context.taskId);
