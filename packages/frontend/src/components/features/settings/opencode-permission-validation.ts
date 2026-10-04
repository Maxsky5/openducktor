import {
  agentRoleSchema,
  openCodeRuntimeConfigSchema,
  type OpenCodeRuntimeConfig,
} from "@openducktor/contracts";
import { AGENT_ROLE_LABELS } from "@/types/agent-role-labels";

export const validateOpenCodePermissions = (
  config: OpenCodeRuntimeConfig | undefined,
): string[] => {
  if (!config) return [];
  const parsed = openCodeRuntimeConfigSchema.safeParse(config);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const [scope, roleOrRules, ruleOrIndex, indexOrField] = issue.path;
    if (scope === "defaults") return `Defaults rule ${Number(ruleOrIndex) + 1}: ${issue.message}`;
    if (scope === "roleOverrides") {
      const role = agentRoleSchema.safeParse(roleOrRules);
      const label = role.success ? AGENT_ROLE_LABELS[role.data] : String(roleOrRules);
      return `${label} rule ${Number(indexOrField) + 1}: ${issue.message}`;
    }
    return issue.message;
  });
};
