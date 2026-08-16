import type { AgentSessionAssociation, AgentSessionScope } from "@openducktor/contracts";
import { workflowAgentSessionScope } from "@openducktor/core";
import type { AgentTaskSessionBinding } from "@/types/agent-orchestrator";

export const resolveSessionRuntimeScope = ({
  taskBinding,
  liveSessionAssociation,
}: {
  taskBinding: AgentTaskSessionBinding | null;
  liveSessionAssociation: AgentSessionAssociation | null;
}): AgentSessionScope | null => {
  if (taskBinding) {
    return workflowAgentSessionScope(taskBinding.taskId, taskBinding.role);
  }
  return liveSessionAssociation?.kind === "unbound" ? null : (liveSessionAssociation ?? null);
};
