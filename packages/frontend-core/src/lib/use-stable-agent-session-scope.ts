import type { AgentSessionScope } from "@openducktor/contracts";
import { useMemo } from "react";

export const useStableAgentSessionScope = (
  scope: AgentSessionScope | null | undefined,
): AgentSessionScope | null => {
  const kind = scope?.kind ?? null;
  const taskId = scope?.kind === "workflow" ? scope.taskId : null;
  const workspaceId = scope?.workspaceId ?? null;
  const role = scope?.kind === "workflow" ? scope.role : null;

  return useMemo(() => {
    if (workspaceId === null) return null;
    if (kind === "repository") return { kind: "repository", workspaceId };
    if (kind === "workflow" && taskId !== null && role !== null) {
      return { kind: "workflow", workspaceId, taskId, role };
    }
    return null;
  }, [kind, role, taskId, workspaceId]);
};
