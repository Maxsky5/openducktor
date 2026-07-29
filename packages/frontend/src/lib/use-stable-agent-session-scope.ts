import type { AgentSessionScope } from "@openducktor/contracts";
import { useMemo } from "react";

export const useStableAgentSessionScope = (
  scope: AgentSessionScope | null | undefined,
): AgentSessionScope | null => {
  const kind = scope?.kind ?? null;
  const taskId = scope?.kind === "workflow" ? scope.taskId : null;
  const role = scope?.kind === "workflow" ? scope.role : null;

  return useMemo(() => {
    if (kind === "repository") {
      return { kind: "repository" };
    }
    if (kind === "workflow" && taskId !== null && role !== null) {
      return { kind: "workflow", taskId, role };
    }
    return null;
  }, [kind, role, taskId]);
};
