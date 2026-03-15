import { agentRoleValues } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { AGENT_ROLE_LABELS } from "@/types";

export {
  buildRebaseConflictResolutionPrompt,
  firstScenario,
  isScenario,
  kickoffPromptForScenario,
  SCENARIO_LABELS,
  SCENARIOS_BY_ROLE,
} from "../shared/session-start-prompts";

export const ROLE_OPTIONS: Array<{
  role: AgentRole;
  label: string;
  icon: typeof Sparkles;
}> = [
  { role: "spec", label: AGENT_ROLE_LABELS.spec, icon: Sparkles },
  { role: "planner", label: AGENT_ROLE_LABELS.planner, icon: Bot },
  { role: "build", label: AGENT_ROLE_LABELS.build, icon: Wrench },
  { role: "qa", label: AGENT_ROLE_LABELS.qa, icon: ShieldCheck },
];

const AGENT_ROLE_SET = new Set<string>(agentRoleValues);

export const isRole = (value: string | null): value is AgentRole =>
  value != null && AGENT_ROLE_SET.has(value);
