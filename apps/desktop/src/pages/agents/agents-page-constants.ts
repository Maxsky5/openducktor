import type { RepoPromptOverrides } from "@openducktor/contracts";
import { type AgentRole, type AgentScenario, buildAgentKickoffPrompt } from "@openducktor/core";
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
  qa_review: "QA Review",
};

export const isRole = (value: string | null): value is AgentRole =>
  value === "spec" || value === "planner" || value === "build" || value === "qa";

export const isScenario = (value: string | null): value is AgentScenario =>
  value === "spec_initial" ||
  value === "planner_initial" ||
  value === "build_implementation_start" ||
  value === "build_after_qa_rejected" ||
  value === "build_after_human_request_changes" ||
  value === "qa_review";

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
  scenario: AgentScenario,
  taskId: string,
  options?: {
    overrides?: RepoPromptOverrides;
    task?: {
      title?: string;
      issueType?: "task" | "feature" | "bug" | "epic";
      status?: string;
      qaRequired?: boolean;
      description?: string;
      acceptanceCriteria?: string;
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
