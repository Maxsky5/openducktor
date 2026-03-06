import { z } from "zod";

export const agentRoleValues = ["spec", "planner", "build", "qa"] as const;
export const agentScenarioValues = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "build_rebase_conflict_resolution",
  "qa_review",
] as const;
export const agentKickoffScenarioValues = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "qa_review",
] as const;
export const agentToolNameValues = [
  "odt_read_task",
  "odt_set_spec",
  "odt_set_plan",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_qa_approved",
  "odt_qa_rejected",
] as const;

export const agentRoleSchema = z.enum(agentRoleValues);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const agentScenarioSchema = z.enum(agentScenarioValues);
export type AgentScenario = z.infer<typeof agentScenarioSchema>;

export const agentKickoffScenarioSchema = z.enum(agentKickoffScenarioValues);
export type AgentKickoffScenario = z.infer<typeof agentKickoffScenarioSchema>;

export const isAgentKickoffScenario = (value: AgentScenario): value is AgentKickoffScenario => {
  switch (value) {
    case "spec_initial":
    case "planner_initial":
    case "build_implementation_start":
    case "build_after_qa_rejected":
    case "build_after_human_request_changes":
    case "qa_review":
      return true;
    case "build_rebase_conflict_resolution":
      return false;
  }
};

export const agentToolNameSchema = z.enum(agentToolNameValues);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;
