import type { AgentRole } from "../types/agent-orchestrator";
import type {
  AgentSessionLivePendingApprovalRequest,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY } from "../types/agent-orchestrator";
import { normalizeOdtWorkflowToolName } from "./odt-workflow-tools";

export const READ_ONLY_AGENT_ROLES = [
  "spec",
  "planner",
  "qa",
] as const satisfies readonly AgentRole[];
export const READ_ONLY_AGENT_ROLE_SET = new Set<AgentRole>(READ_ONLY_AGENT_ROLES);

export const isReadOnlyAgentRole = (role: AgentRole): boolean => READ_ONLY_AGENT_ROLE_SET.has(role);

/** Permitted workflow writes retain their role permissions; native mutations do not. */
export const requiresReadOnlyApprovalRejection = (
  role: AgentRole,
  request: AgentSessionLivePendingApprovalRequest,
  descriptor: RuntimeDescriptor,
): boolean => {
  if (!isReadOnlyAgentRole(role)) return false;
  let permittedWorkflowTool = false;
  for (const name of [request.action?.name, request.tool?.name]) {
    if (!name) continue;
    const canonical = normalizeOdtWorkflowToolName(name, descriptor.workflowToolAliasesByCanonical);
    if (canonical) {
      if (!AGENT_ROLE_TOOL_POLICY[role].some((tool) => tool === canonical)) return true;
      permittedWorkflowTool = true;
    }
    if (descriptor.readOnlyRoleBlockedTools.includes(name)) return true;
  }
  return !permittedWorkflowTool && request.mutation === "mutating";
};
