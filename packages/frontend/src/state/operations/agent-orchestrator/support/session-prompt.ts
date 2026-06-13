import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { AGENT_SESSION_SYSTEM_PROMPT_PREFIX, buildAgentSystemPrompt } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";

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

export const SYSTEM_PROMPT_PREFIX = AGENT_SESSION_SYSTEM_PROMPT_PREFIX;
const SYSTEM_PROMPT_MESSAGE_ID_PREFIX = "history:system-prompt:";

export const isSessionSystemPromptMessage = (message: AgentChatMessage): boolean =>
  message.role === "system" &&
  (message.id.startsWith(SYSTEM_PROMPT_MESSAGE_ID_PREFIX) ||
    message.content.startsWith(SYSTEM_PROMPT_PREFIX));

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
}: SessionHeaderInput): AgentChatMessage[] => {
  if (!includeSystemPrompt || systemPrompt.trim().length === 0) {
    return [];
  }

  return [
    {
      id: `history:system-prompt:${externalSessionId}`,
      role: "system",
      content: `${SYSTEM_PROMPT_PREFIX}${systemPrompt}`,
      timestamp: startedAt,
    },
  ];
};
