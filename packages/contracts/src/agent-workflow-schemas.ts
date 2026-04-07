import { z } from "zod";

export const agentRoleValues = ["spec", "planner", "build", "qa"] as const;
export const agentSessionStartModeValues = ["fresh", "reuse", "fork"] as const;
export const agentScenarioValues = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "build_pull_request_generation",
  "build_rebase_conflict_resolution",
  "qa_review",
] as const;
export const agentKickoffScenarioValues = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "build_pull_request_generation",
  "qa_review",
] as const;
export const agentToolNameValues = [
  "odt_read_task",
  "odt_read_task_documents",
  "odt_set_spec",
  "odt_set_plan",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_set_pull_request",
  "odt_qa_approved",
  "odt_qa_rejected",
] as const;

export const agentRoleSchema = z.enum(agentRoleValues);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const agentSessionStartModeSchema = z.enum(agentSessionStartModeValues);
export type AgentSessionStartMode = z.infer<typeof agentSessionStartModeSchema>;

export const agentScenarioSchema = z.enum(agentScenarioValues);
export type AgentScenario = z.infer<typeof agentScenarioSchema>;

export const agentKickoffScenarioSchema = z.enum(agentKickoffScenarioValues);
export type AgentKickoffScenario = z.infer<typeof agentKickoffScenarioSchema>;

export type AgentScenarioDefinition = {
  role: AgentRole;
  label: string;
  allowedStartModes: AgentSessionStartMode[];
  defaultStartMode: AgentSessionStartMode;
  supportsKickoff: boolean;
};

export const agentScenarioDefinitionByScenario = {
  spec_initial: {
    role: "spec",
    label: "Spec",
    allowedStartModes: ["fresh"],
    defaultStartMode: "fresh",
    supportsKickoff: true,
  },
  planner_initial: {
    role: "planner",
    label: "Planner",
    allowedStartModes: ["fresh"],
    defaultStartMode: "fresh",
    supportsKickoff: true,
  },
  build_implementation_start: {
    role: "build",
    label: "Start Implementation",
    allowedStartModes: ["fresh"],
    defaultStartMode: "fresh",
    supportsKickoff: true,
  },
  build_after_qa_rejected: {
    role: "build",
    label: "Fix QA Rejection",
    allowedStartModes: ["fresh", "reuse"],
    defaultStartMode: "reuse",
    supportsKickoff: true,
  },
  build_after_human_request_changes: {
    role: "build",
    label: "Apply Human Changes",
    allowedStartModes: ["fresh", "reuse"],
    defaultStartMode: "reuse",
    supportsKickoff: true,
  },
  build_pull_request_generation: {
    role: "build",
    label: "Generate Pull Request",
    allowedStartModes: ["reuse", "fork"],
    defaultStartMode: "reuse",
    supportsKickoff: true,
  },
  build_rebase_conflict_resolution: {
    role: "build",
    label: "Resolve Git Conflict",
    allowedStartModes: ["fresh", "reuse"],
    defaultStartMode: "reuse",
    supportsKickoff: false,
  },
  qa_review: {
    role: "qa",
    label: "QA Review",
    allowedStartModes: ["fresh", "reuse"],
    defaultStartMode: "reuse",
    supportsKickoff: true,
  },
} satisfies Record<AgentScenario, AgentScenarioDefinition>;

export const getAgentScenarioDefinition = (scenario: AgentScenario): AgentScenarioDefinition =>
  agentScenarioDefinitionByScenario[scenario];

export const getAgentScenariosForRole = (role: AgentRole): AgentScenario[] =>
  agentScenarioValues.filter(
    (scenario): scenario is AgentScenario =>
      agentScenarioDefinitionByScenario[scenario].role === role,
  );

export const defaultAgentScenarioForRole = (role: AgentRole): AgentScenario => {
  const [scenario] = getAgentScenariosForRole(role);
  if (!scenario) {
    throw new Error(`Role "${role}" does not define any scenarios.`);
  }
  return scenario;
};

export const isScenarioStartModeAllowed = (
  scenario: AgentScenario,
  startMode: AgentSessionStartMode,
): boolean => getAgentScenarioDefinition(scenario).allowedStartModes.includes(startMode);

export const defaultStartModeForScenario = (scenario: AgentScenario): AgentSessionStartMode =>
  getAgentScenarioDefinition(scenario).defaultStartMode;

export const isAgentKickoffScenario = (value: AgentScenario): value is AgentKickoffScenario => {
  return getAgentScenarioDefinition(value).supportsKickoff;
};

export const agentToolNameSchema = z.enum(agentToolNameValues);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;
