import {
  agentRoleValues,
  agentScenarioValues,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import {
  type AgentKickoffScenario,
  type AgentPromptGitContext,
  type AgentRole,
  type AgentScenario,
  buildAgentKickoffPrompt,
  buildAgentMessagePrompt,
} from "@openducktor/core";
import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { AGENT_ROLE_LABELS } from "@/types";

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

export const SCENARIOS_BY_ROLE: Record<AgentRole, AgentScenario[]> = {
  spec: ["spec_initial"],
  planner: ["planner_initial"],
  build: [
    "build_implementation_start",
    "build_after_qa_rejected",
    "build_after_human_request_changes",
  ],
  qa: ["qa_review"],
};

export const SCENARIO_LABELS: Record<AgentScenario, string> = {
  spec_initial: "Spec",
  planner_initial: "Planner",
  build_implementation_start: "Start Implementation",
  build_after_qa_rejected: "Fix QA Rejection",
  build_after_human_request_changes: "Apply Human Changes",
  build_rebase_conflict_resolution: "Resolve Rebase Conflict",
  qa_review: "QA Review",
};

const AGENT_ROLE_SET = new Set<string>(agentRoleValues);
const AGENT_SCENARIO_SET = new Set<string>(agentScenarioValues);

export const isRole = (value: string | null): value is AgentRole =>
  value != null && AGENT_ROLE_SET.has(value);

export const isScenario = (value: string | null): value is AgentScenario =>
  value != null && AGENT_SCENARIO_SET.has(value);

export const firstScenario = (role: AgentRole): AgentScenario => {
  const scenarios = SCENARIOS_BY_ROLE[role];
  const first = scenarios[0];
  if (first) {
    return first;
  }
  return "spec_initial";
};

export const kickoffPromptForScenario = (
  role: AgentRole,
  scenario: AgentKickoffScenario,
  taskId: string,
  options?: {
    overrides?: RepoPromptOverrides;
    task?: {
      title?: string;
      issueType?: "task" | "feature" | "bug" | "epic";
      status?: string;
      qaRequired?: boolean;
      description?: string;
      specMarkdown?: string;
      planMarkdown?: string;
      latestQaReportMarkdown?: string;
    };
  },
): string => {
  return buildAgentKickoffPrompt({
    role,
    scenario,
    task: {
      taskId,
      ...(options?.task ?? {}),
    },
    overrides: options?.overrides ?? {},
  });
};

export const buildRebaseConflictResolutionPrompt = (
  taskId: string,
  options?: {
    overrides?: RepoPromptOverrides;
    task?: {
      title?: string;
      issueType?: "task" | "feature" | "bug" | "epic";
      status?: string;
      qaRequired?: boolean;
      description?: string;
      specMarkdown?: string;
      planMarkdown?: string;
      latestQaReportMarkdown?: string;
    };
    git?: AgentPromptGitContext;
  },
): string => {
  return buildAgentMessagePrompt({
    role: "build",
    templateId: "message.build_rebase_conflict_resolution",
    task: {
      taskId,
      ...(options?.task ?? {}),
    },
    ...(options?.git ? { git: options.git } : {}),
    overrides: options?.overrides ?? {},
  });
};
