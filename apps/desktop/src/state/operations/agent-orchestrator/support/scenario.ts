import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import {
  type AgentKickoffScenario,
  type AgentRole,
  type AgentScenario,
  type BuildAgentKickoffPromptInput,
  buildAgentKickoffPrompt,
} from "@openducktor/core";
import { resolveBuildContinuationScenario } from "@/lib/build-scenarios";

export const inferScenario = (role: AgentRole, task: TaskCard): AgentScenario => {
  if (role === "spec") {
    return "spec_initial";
  }
  if (role === "planner") {
    return "planner_initial";
  }
  if (role === "qa") {
    return "qa_review";
  }

  return resolveBuildContinuationScenario(task);
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
