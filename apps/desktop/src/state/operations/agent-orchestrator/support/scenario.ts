import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import {
  type AgentKickoffScenario,
  type AgentRole,
  type AgentScenario,
  type BuildAgentKickoffPromptInput,
  buildAgentKickoffPrompt,
} from "@openducktor/core";

const hasMarkdown = (value: string): boolean => value.trim().length > 0;

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

export const kickoffPrompt = (
  role: AgentRole,
  scenario: AgentKickoffScenario,
  taskId: string,
): string => {
  return buildAgentKickoffPrompt({
    role,
    scenario,
    task: { taskId },
  });
};

export const kickoffPromptWithTaskContext = (
  role: AgentRole,
  scenario: AgentKickoffScenario,
  task: BuildAgentKickoffPromptInput["task"],
  overrides?: RepoPromptOverrides,
): string => {
  return buildAgentKickoffPrompt({
    role,
    scenario,
    task,
    ...(overrides ? { overrides } : {}),
  });
};
