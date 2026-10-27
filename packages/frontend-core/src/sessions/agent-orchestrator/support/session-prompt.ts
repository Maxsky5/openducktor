import type { RepoPromptOverrides } from "@openducktor/contracts";
import { AGENT_SESSION_SYSTEM_PROMPT_PREFIX } from "@openducktor/core";
import {
  buildAgentSystemPrompt,
  type BuiltinRoleId as AgentRole,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { AgentChatMessage } from "../../../types/agent-orchestrator";

export type SessionPromptTask = Pick<
  TaskCard,
  "id" | "title" | "issueType" | "status" | "description"
>;

type SessionPromptInput = {
  role: AgentRole;
  task: SessionPromptTask;
  promptOverrides: RepoPromptOverrides;
};

type SessionPromptContext = {
  systemPrompt: string;
};

type SessionHeaderInput = {
  externalSessionId: string;
  systemPrompt: string;
  startedAt: string;
  includeSystemPrompt?: boolean;
};

type LoadSessionPromptContextInput = Pick<SessionPromptInput, "role" | "task"> & {
  workspaceId: string;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

export const SYSTEM_PROMPT_PREFIX = AGENT_SESSION_SYSTEM_PROMPT_PREFIX;
const SYSTEM_PROMPT_MESSAGE_ID_PREFIX = "history:system-prompt:";

export const isSessionSystemPromptMessage = (message: AgentChatMessage): boolean =>
  message.role === "system" &&
  (message.id.startsWith(SYSTEM_PROMPT_MESSAGE_ID_PREFIX) ||
    message.content.startsWith(SYSTEM_PROMPT_PREFIX));

const buildSessionSystemPrompt = ({ role, task, promptOverrides }: SessionPromptInput): string =>
  buildAgentSystemPrompt({
    role,
    task: {
      taskId: task.id,
      title: task.title,
      issueType: task.issueType,
      status: task.status,
      description: task.description,
    },
    overrides: promptOverrides,
  });

export const loadSessionPromptContext = async ({
  workspaceId,
  role,
  task,
  loadRepoPromptOverrides,
}: LoadSessionPromptContextInput): Promise<SessionPromptContext> => {
  const promptOverrides = await loadRepoPromptOverrides(workspaceId);

  return {
    systemPrompt: buildSessionSystemPrompt({
      role,
      task,
      promptOverrides,
    }),
  };
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
