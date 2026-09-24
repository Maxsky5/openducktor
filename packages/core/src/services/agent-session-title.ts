import type { AgentSessionScope } from "@openducktor/contracts";
import type { AgentSessionSummary } from "../ports/agent-engine";
import type { AgentRole } from "../types/agent-orchestrator";

export const formatWorkflowAgentSessionTitle = (role: AgentRole, taskId: string): string =>
  `${role.toUpperCase()} ${taskId}`;

/**
 * The runtime session title for a scope.
 * A repository scope carries the title from its Workspace Session record.
 */
export const agentSessionTitle = (scope: AgentSessionScope): string | undefined => {
  if (scope.kind === "repository") {
    return scope.title;
  }
  return formatWorkflowAgentSessionTitle(scope.role, scope.taskId);
};

/**
 * Adds the scope's runtime session title to the value.
 * A scope without a title returns the value unchanged.
 */
export const withAgentSessionTitle = <Value extends object>(
  value: Value,
  scope: AgentSessionScope,
): Value & { title?: string } => {
  const title = agentSessionTitle(scope);
  return title === undefined ? value : { ...value, title };
};

/**
 * Sets the summary title and the repository association title.
 * Other association kinds keep their stored value.
 */
export const withSummaryTitle = (
  summary: AgentSessionSummary,
  title: string,
): AgentSessionSummary => ({
  ...summary,
  title,
  sessionAssociation:
    summary.sessionAssociation.kind === "repository"
      ? { kind: "repository", title }
      : summary.sessionAssociation,
});

/**
 * Removes the summary title and the repository association title.
 * Use it when the runtime rejects a title update, so the summary reports the
 * runtime title. Other association kinds keep their stored value.
 */
export const withoutSummaryTitle = (summary: AgentSessionSummary): AgentSessionSummary => {
  const { title: _title, ...rest } = summary;
  return {
    ...rest,
    sessionAssociation:
      summary.sessionAssociation.kind === "repository"
        ? { kind: "repository" }
        : summary.sessionAssociation,
  };
};
