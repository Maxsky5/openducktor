import { AGENT_SESSION_SYSTEM_PROMPT_PREFIX } from "@openducktor/core";
import {
  type PromptSettings,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { AgentChatMessage } from "../../../types/agent-orchestrator";

type SessionPromptTask = Pick<
  TaskCard,
  "id" | "title" | "issueType" | "status" | "description" | "taskWorkflow"
>;

type SessionPromptInput = {
  role: AgentRole;
  task: SessionPromptTask;
  promptSettings: PromptSettings;
};

type SessionPromptContext = {
  systemPrompt: string;
};

export type LoadSessionPromptContextInput = Pick<SessionPromptInput, "role" | "task"> & {
  workspaceId: string;
  /** The saved prompt layers of the global settings and of the repository of the workspace. */
  loadPromptSettings: (workspaceId: string) => Promise<PromptSettings>;
};

const SYSTEM_PROMPT_MESSAGE_ID_PREFIX = "history:system-prompt:";

export const isSessionSystemPromptMessage = (message: AgentChatMessage): boolean =>
  message.role === "system" &&
  (message.id.startsWith(SYSTEM_PROMPT_MESSAGE_ID_PREFIX) ||
    message.content.startsWith(AGENT_SESSION_SYSTEM_PROMPT_PREFIX));

const buildSessionSystemPrompt = ({ role, task, promptSettings }: SessionPromptInput): string =>
  task.taskWorkflow.prompts.systemPrompt({
    role,
    task: {
      taskId: task.id,
      title: task.title,
      issueType: task.issueType,
      status: task.status,
      description: task.description,
    },
    settings: promptSettings,
  }).prompt;

export const loadSessionPromptContext = async ({
  workspaceId,
  role,
  task,
  loadPromptSettings,
}: LoadSessionPromptContextInput): Promise<SessionPromptContext> => {
  const promptSettings = await loadPromptSettings(workspaceId);

  return {
    systemPrompt: buildSessionSystemPrompt({
      role,
      task,
      promptSettings,
    }),
  };
};
