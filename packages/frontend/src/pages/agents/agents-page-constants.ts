import { ROLE_OPTIONS } from "@/lib/agent-role-presentation";
import { BUILTIN_ROLE_IDS, type BuiltinRoleId as AgentRole } from "@openducktor/workflows";

export { ROLE_OPTIONS };

export {
  kickoffPromptForLaunchAction,
  kickoffPromptForTemplate,
} from "@openducktor/frontend-core/sessions/start/session-start-prompts";

export const AGENT_ROLE_ORDER: AgentRole[] = ROLE_OPTIONS.map((option) => option.role);

const AGENT_ROLE_SET = new Set<string>(BUILTIN_ROLE_IDS);

export const isRole = (value: string | null): value is AgentRole =>
  value != null && AGENT_ROLE_SET.has(value);
