import { agentRoleValues } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { ROLE_OPTIONS } from "@/lib/agent-role-presentation";

export { ROLE_OPTIONS };

export {
  firstLaunchAction,
  kickoffPromptForLaunchAction,
  kickoffPromptForTemplate,
  LAUNCH_ACTION_LABELS,
  LAUNCH_ACTIONS_BY_ROLE,
} from "@openducktor/frontend-core/sessions/start/session-start-prompts";

export const AGENT_ROLE_ORDER: AgentRole[] = ROLE_OPTIONS.map((option) => option.role);

const AGENT_ROLE_SET = new Set<string>(agentRoleValues);

export const isRole = (value: string | null): value is AgentRole =>
  value != null && AGENT_ROLE_SET.has(value);
