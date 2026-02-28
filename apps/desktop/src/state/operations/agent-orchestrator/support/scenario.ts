import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";

const hasMarkdown = (value: string): boolean => value.trim().length > 0;
const quoteTaskIdForPrompt = (taskId: string): string => JSON.stringify(taskId);

const buildKickoffBaseMessage = (role: AgentRole, scenario: AgentScenario): string => {
  if (role === "spec") {
    return "Create or update the specification and call odt_set_spec with complete markdown when ready.";
  }
  if (role === "planner") {
    return "Create or update the implementation plan and call odt_set_plan when ready.";
  }
  if (role === "qa") {
    return "Perform QA review now and call exactly one of odt_qa_approved or odt_qa_rejected.";
  }
  if (scenario === "build_after_qa_rejected") {
    return "Address all QA rejection findings and call odt_build_completed when done.";
  }
  if (scenario === "build_after_human_request_changes") {
    return "Apply all human-requested changes and call odt_build_completed when done.";
  }
  return "Start implementation now. Use odt_build_blocked/odt_build_resumed/odt_build_completed for workflow transitions.";
};

export const inferScenario = (
  role: AgentRole,
  task: TaskCard,
  docs: {
    specMarkdown: string;
    planMarkdown: string;
    qaMarkdown: string;
  },
): AgentScenario => {
  if (role === "spec") {
    return "spec_initial";
  }
  if (role === "planner") {
    return "planner_initial";
  }
  if (role === "qa") {
    return "qa_review";
  }

  if (hasMarkdown(docs.qaMarkdown) && task.status === "in_progress") {
    return "build_after_qa_rejected";
  }

  if (task.status === "in_progress" && !hasMarkdown(docs.qaMarkdown)) {
    return "build_after_human_request_changes";
  }

  return "build_implementation_start";
};

export const kickoffPrompt = (role: AgentRole, scenario: AgentScenario, taskId: string): string => {
  const taskInstruction = `Use taskId ${quoteTaskIdForPrompt(taskId)} for every odt_* tool call.`;
  return `${buildKickoffBaseMessage(role, scenario)}\n${taskInstruction}`;
};
