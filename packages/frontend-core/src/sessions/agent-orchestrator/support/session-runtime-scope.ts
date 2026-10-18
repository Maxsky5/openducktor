import type { AgentSessionAssociation, AgentSessionScope } from "@openducktor/contracts";

export const resolveSessionRuntimeScope = (
  sessionAssociation: AgentSessionAssociation,
): AgentSessionScope | null => (sessionAssociation.kind === "unbound" ? null : sessionAssociation);
