import { agentScenarioValues, type RepoPromptOverrides } from "@openducktor/contracts";
import {
  type AgentKickoffScenario,
  type AgentPromptGitContext,
  type AgentRole,
  type AgentScenario,
  buildAgentKickoffPrompt,
  buildAgentMessagePrompt,
} from "@openducktor/core";

type TaskPromptContext = {
  title?: string;
  issueType?: "task" | "feature" | "bug" | "epic";
  status?: string;
  qaRequired?: boolean;
  description?: string;
  specMarkdown?: string;
  planMarkdown?: string;
  latestQaReportMarkdown?: string;
};

type SessionStartPromptOptions = {
  overrides?: RepoPromptOverrides;
  task?: TaskPromptContext;
};

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

const AGENT_SCENARIO_SET = new Set<string>(agentScenarioValues);

export const isScenario = (value: string | null): value is AgentScenario =>
  value != null && AGENT_SCENARIO_SET.has(value);

export const firstScenario = (role: AgentRole): AgentScenario => {
  const first = SCENARIOS_BY_ROLE[role][0];
  return first ?? "spec_initial";
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
    overrides: options?.overrides ?? {},
  });
};

export const buildRebaseConflictResolutionPrompt = (
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
