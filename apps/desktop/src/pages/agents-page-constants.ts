import type { AgentRole, AgentScenario } from "@openducktor/core";
import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";

export const ROLE_OPTIONS: Array<{
  role: AgentRole;
  label: string;
  icon: typeof Sparkles;
}> = [
  { role: "spec", label: "Spec", icon: Sparkles },
  { role: "planner", label: "Planner", icon: Bot },
  { role: "build", label: "Build", icon: Wrench },
  { role: "qa", label: "QA", icon: ShieldCheck },
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

const quoteTaskIdForPrompt = (taskId: string): string => JSON.stringify(taskId);

export const kickoffPromptForScenario = (
  role: AgentRole,
  scenario: AgentScenario,
  taskId: string,
): string => {
  const taskInstruction = `Use taskId ${quoteTaskIdForPrompt(taskId)} for every odt_* tool call.`;
  if (role === "spec") {
    const base =
      "Create or update the specification and call odt_set_spec with complete markdown when ready.";
    return `${base}\n${taskInstruction}`;
  }
  if (role === "planner") {
    const base = "Create or update the implementation plan and call odt_set_plan when ready.";
    return `${base}\n${taskInstruction}`;
  }
  if (role === "qa") {
    return `Perform QA review now and call exactly one of odt_qa_approved or odt_qa_rejected.\n${taskInstruction}`;
  }
  if (scenario === "build_after_qa_rejected") {
    return `Address all QA rejection findings and call odt_build_completed when done.\n${taskInstruction}`;
  }
  if (scenario === "build_after_human_request_changes") {
    return `Apply all human-requested changes and call odt_build_completed when done.\n${taskInstruction}`;
  }
  return `Start implementation now. Use odt_build_blocked/odt_build_resumed/odt_build_completed for workflow transitions.\n${taskInstruction}`;
};
