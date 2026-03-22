import type { AgentRole, AgentScenario } from "@openducktor/core";
import { host } from "@/state/operations/shared/host";
import type { AgentSessionState } from "@/types/agent-orchestrator";

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

const pickLatestBuilderSession = (
  sessions: AgentSessionState[],
  taskId: string,
): AgentSessionState | null => {
  return (
    sessions
      .filter((session) => session.taskId === taskId && session.role === "build")
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
  );
};

export const resolveQaBuilderSessionContext = async (params: {
  activeRepo: string | null;
  taskId: string;
  sessions?: AgentSessionState[];
}): Promise<{ sessionId?: string | null; workingDirectory: string }> => {
  const latestBuilderSession = pickLatestBuilderSession(params.sessions ?? [], params.taskId);
  if (latestBuilderSession) {
    const workingDirectory = latestBuilderSession.workingDirectory.trim();
    if (workingDirectory.length > 0) {
      return {
        sessionId: latestBuilderSession.sessionId,
        workingDirectory,
      };
    }
  }

  if (!params.activeRepo) {
    throw new Error("No active repository selected.");
  }

  return {
    workingDirectory: (await host.buildContinuationTargetGet(params.activeRepo, params.taskId))
      .workingDirectory,
  };
};
