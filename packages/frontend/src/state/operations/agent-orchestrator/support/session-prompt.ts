import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { buildAgentSystemPrompt } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { everySessionMessage, getSessionMessageCount } from "./messages";

type SessionPromptTask = Pick<
  TaskCard,
  "id" | "title" | "issueType" | "status" | "aiReviewEnabled" | "description"
>;

type SessionPromptInput = {
  role: AgentRole;
  task: SessionPromptTask;
  promptOverrides: RepoPromptOverrides;
};

type SessionPromptContext = {
  promptOverrides: RepoPromptOverrides;
  systemPrompt: string;
};

type LoadSessionPromptInputsInput = {
  workspaceId: string;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type CreateSessionPromptContextInput = SessionPromptInput;

type SessionHeaderInput = {
  externalSessionId: string;
  systemPrompt: string;
  startedAt: string;
  includeSystemPrompt?: boolean;
};

export const buildSessionSystemPrompt = ({
  role,
  task,
  promptOverrides,
}: SessionPromptInput): string =>
  buildAgentSystemPrompt({
    role,
    task: {
      taskId: task.id,
      title: task.title,
      issueType: task.issueType,
      status: task.status,
      qaRequired: task.aiReviewEnabled,
      description: task.description,
    },
    overrides: promptOverrides,
  });

export const loadSessionPromptInputs = async ({
  workspaceId,
  loadRepoPromptOverrides,
}: LoadSessionPromptInputsInput): Promise<Pick<SessionPromptContext, "promptOverrides">> => {
  const promptOverrides = await loadRepoPromptOverrides(workspaceId);

  return {
    promptOverrides,
  };
};

export const createSessionPromptContext = ({
  role,
  task,
  promptOverrides,
}: CreateSessionPromptContextInput): SessionPromptContext => {
  return {
    promptOverrides,
    systemPrompt: buildSessionSystemPrompt({
      role,
      task,
      promptOverrides,
    }),
  };
};

export const loadSessionPromptContext = async ({
  workspaceId,
  role,
  task,
  loadRepoPromptOverrides,
}: LoadSessionPromptInputsInput & {
  role: AgentRole;
  task: SessionPromptTask;
}): Promise<SessionPromptContext> => {
  const { promptOverrides } = await loadSessionPromptInputs({
    workspaceId,
    loadRepoPromptOverrides,
  });

  return createSessionPromptContext({
    role,
    task,
    promptOverrides,
  });
};

export const buildSessionHeaderMessages = ({
  externalSessionId,
  systemPrompt,
  startedAt,
  includeSystemPrompt = true,
}: SessionHeaderInput): AgentSessionState["messages"] => {
  if (!includeSystemPrompt) {
    return [];
  }

  return [
    {
      id: `history:system-prompt:${externalSessionId}`,
      role: "system",
      content: `System prompt:\n\n${systemPrompt}`,
      timestamp: startedAt,
    },
  ];
};

export const isSessionHeaderMessageId = (messageId: string, externalSessionId: string): boolean => {
  return messageId === `history:system-prompt:${externalSessionId}`;
};

export const hasOnlySessionHeaderMessages = (
  session: Pick<AgentSessionState, "externalSessionId" | "messages">,
): boolean => {
  return (
    getSessionMessageCount(session) > 0 &&
    everySessionMessage(session, (message) =>
      isSessionHeaderMessageId(message.id, session.externalSessionId),
    )
  );
};
