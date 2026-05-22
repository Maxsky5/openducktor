import type { AgentSessionRecord, RepoPromptOverrides } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { buildSessionHeaderMessages, buildSessionSystemPrompt } from "../support/session-prompt";
import type { HydrationPromptAssembler, PromptAssemblerStageInput } from "./load-sessions-stages";

export const createHydrationPromptAssemblerStage = ({
  taskId,
  taskRef,
  historyPreludeMode = "task_context",
}: PromptAssemblerStageInput): HydrationPromptAssembler => {
  const buildHydrationPreludeMessages = async ({
    record,
    promptOverrides,
  }: {
    record: AgentSessionRecord;
    promptOverrides: RepoPromptOverrides;
  }): Promise<AgentSessionState["messages"]> => {
    if (historyPreludeMode === "none") {
      return [];
    }
    const task = taskRef.current.find((entry) => entry.id === taskId);
    if (!task) {
      return buildSessionHeaderMessages({
        externalSessionId: record.externalSessionId,
        systemPrompt: "",
        startedAt: record.startedAt,
        includeSystemPrompt: false,
      });
    }

    const systemPrompt = buildSessionSystemPrompt({
      role: record.role,
      task,
      promptOverrides,
    });

    return buildSessionHeaderMessages({
      externalSessionId: record.externalSessionId,
      systemPrompt,
      startedAt: record.startedAt,
    });
  };

  const buildHydrationSystemPrompt = async ({
    record,
    promptOverrides,
  }: {
    record: AgentSessionRecord;
    promptOverrides: RepoPromptOverrides;
  }): Promise<string> => {
    if (historyPreludeMode === "none") {
      return "";
    }
    const task = taskRef.current.find((entry) => entry.id === taskId);
    if (!task) {
      return "";
    }

    return buildSessionSystemPrompt({
      role: record.role,
      task,
      promptOverrides,
    });
  };

  return {
    buildHydrationPreludeMessages,
    buildHydrationSystemPrompt,
  };
};
