import { agentScenarioValues, type RepoPromptOverrides } from "@openducktor/contracts";
import {
  type AgentKickoffScenario,
  type AgentPromptGitContext,
  type AgentRole,
  type AgentScenario,
  type BuildAgentKickoffPromptInput,
  buildAgentKickoffPrompt,
  buildAgentMessagePrompt,
  defaultAgentScenarioForRole,
  getAgentScenarioDefinition,
  getAgentScenariosForRole,
} from "@openducktor/core";

type TaskPromptContext = {
  title?: string;
  issueType?: "task" | "feature" | "bug" | "epic";
  status?: string;
  qaRequired?: boolean;
  description?: string;
};

type SessionStartPromptOptions = {
  overrides?: RepoPromptOverrides;
  task?: TaskPromptContext;
  git?: AgentPromptGitContext;
  extraPlaceholders?: BuildAgentKickoffPromptInput["extraPlaceholders"];
};

export const SCENARIOS_BY_ROLE: Record<AgentRole, AgentScenario[]> = {
  spec: getAgentScenariosForRole("spec"),
  planner: getAgentScenariosForRole("planner"),
  build: getAgentScenariosForRole("build"),
  qa: getAgentScenariosForRole("qa"),
};

export const SCENARIO_LABELS: Record<AgentScenario, string> = {
  spec_initial: getAgentScenarioDefinition("spec_initial").label,
  planner_initial: getAgentScenarioDefinition("planner_initial").label,
  build_implementation_start: getAgentScenarioDefinition("build_implementation_start").label,
  build_after_qa_rejected: getAgentScenarioDefinition("build_after_qa_rejected").label,
  build_after_human_request_changes: getAgentScenarioDefinition("build_after_human_request_changes")
    .label,
  build_pull_request_generation: getAgentScenarioDefinition("build_pull_request_generation").label,
  build_rebase_conflict_resolution: getAgentScenarioDefinition("build_rebase_conflict_resolution")
    .label,
  qa_review: getAgentScenarioDefinition("qa_review").label,
};

const AGENT_SCENARIO_SET = new Set<string>(agentScenarioValues);

export const isScenario = (value: string | null): value is AgentScenario =>
  value != null && AGENT_SCENARIO_SET.has(value);

export const firstScenario = (role: AgentRole): AgentScenario => {
  return defaultAgentScenarioForRole(role);
};

export const kickoffPromptForScenario = (
  role: AgentRole,
  scenario: AgentKickoffScenario,
  taskId: string,
  options?: SessionStartPromptOptions,
): string => {
  return buildAgentKickoffPrompt({
    role,
    scenario,
    task: {
      taskId,
      ...(options?.task ?? {}),
    },
    ...(options?.extraPlaceholders ? { extraPlaceholders: options.extraPlaceholders } : {}),
    ...(options?.git ? { git: options.git } : {}),
    overrides: options?.overrides ?? {},
  });
};

export const buildGitConflictResolutionPrompt = (
  taskId: string,
  options?: SessionStartPromptOptions & {
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
