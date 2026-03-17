import type { AgentRole, AgentScenario } from "@openducktor/core";
import { host } from "@/state/operations/host";

export const isBuildFollowUpScenario = (role: AgentRole, scenario: AgentScenario): boolean => {
  return (
    role === "build" &&
    (scenario === "build_after_qa_rejected" || scenario === "build_after_human_request_changes")
  );
};

export const resolveBuildWorkingDirectoryOverride = async (params: {
  activeRepo: string | null;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
}): Promise<string | null> => {
  if (!params.activeRepo || !isBuildFollowUpScenario(params.role, params.scenario)) {
    return null;
  }

  return (await host.buildContinuationTargetGet(params.activeRepo, params.taskId)).workingDirectory;
};
