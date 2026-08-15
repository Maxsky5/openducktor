import type { AgentSessionAssociation, AgentSessionScope } from "@openducktor/contracts";

export type AgentSessionAssociationTransition =
  | { kind: "accepted"; association: AgentSessionAssociation }
  | { kind: "conflict"; previous: AgentSessionScope; incoming: AgentSessionScope };

export const agentSessionScopesEqual = (
  left: AgentSessionScope,
  right: AgentSessionScope,
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "repository") {
    return true;
  }
  return right.kind === "workflow" && left.taskId === right.taskId && left.role === right.role;
};

export const describeAgentSessionScope = (scope: AgentSessionScope): string => {
  if (scope.kind === "repository") {
    return "repository scope";
  }
  return `workflow scope for task '${scope.taskId}' and role '${scope.role}'`;
};

export const resolveAgentSessionAssociationTransition = (
  previous: AgentSessionAssociation | undefined,
  incoming: AgentSessionAssociation,
): AgentSessionAssociationTransition => {
  if (!previous || previous.kind === "unbound") {
    return { kind: "accepted", association: incoming };
  }
  if (incoming.kind === "unbound") {
    return { kind: "accepted", association: previous };
  }
  if (agentSessionScopesEqual(previous, incoming)) {
    return { kind: "accepted", association: incoming };
  }
  return { kind: "conflict", previous, incoming };
};
