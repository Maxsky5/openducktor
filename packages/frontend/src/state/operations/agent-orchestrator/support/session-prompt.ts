import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { buildAgentSystemPrompt } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { everySessionMessage, getSessionMessageCount } from "./messages";

type SessionPromptTask = Pick<
  TaskCard,
  "id" | "title" | "issueType" | "status" | "aiReviewEnabled" | "description"
>;

type SessionPromptInput = {
  role: AgentRole;
  scenario: AgentScenario;
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
  role: AgentRole;
  scenario: AgentScenario;
  systemPrompt: string;
  startedAt: string;
  eventLabel?: "started" | "forked";
  includeSystemPrompt?: boolean;
};

export const buildSessionSystemPrompt = ({
  role,
  scenario,
  task,
  promptOverrides,
}: SessionPromptInput): string =>
  buildAgentSystemPrompt({
    role,
    scenario,
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
  scenario,
  task,
  promptOverrides,
}: CreateSessionPromptContextInput): SessionPromptContext => {
  return {
    promptOverrides,
    systemPrompt: buildSessionSystemPrompt({
      role,
      scenario,
      task,
      promptOverrides,
    }),
  };
};

export const loadSessionPromptContext = async ({
  workspaceId,
  role,
  scenario,
  task,
  loadRepoPromptOverrides,
}: LoadSessionPromptInputsInput & {
  role: AgentRole;
  scenario: AgentScenario;
  task: SessionPromptTask;
}): Promise<SessionPromptContext> => {
  const { promptOverrides } = await loadSessionPromptInputs({
    workspaceId,
    loadRepoPromptOverrides,
  });

  return createSessionPromptContext({
    role,
    scenario,
    task,
    promptOverrides,
  });
};

export const buildSessionHeaderMessages = ({
  externalSessionId,
  role,
  scenario,
  systemPrompt,
  startedAt,
  eventLabel = "started",
  includeSystemPrompt = true,
}: SessionHeaderInput): AgentSessionState["messages"] => {
  const eventId = eventLabel === "started" ? "start" : eventLabel;
  const messages: AgentSessionState["messages"] = [
    {
      id: `history:session-${eventId}:${externalSessionId}`,
      role: "system",
      content: `Session ${eventLabel} (${role} - ${scenario})`,
      timestamp: startedAt,
    },
  ];

  if (!includeSystemPrompt) {
    return messages;
  }

  return [
    ...messages,
    {
      id: `history:system-prompt:${externalSessionId}`,
      role: "system",
      content: `System prompt:\n\n${systemPrompt}`,
      timestamp: startedAt,
    },
  ];
};

export const isSessionHeaderMessageId = (messageId: string, externalSessionId: string): boolean => {
  return (
    messageId === `history:session-start:${externalSessionId}` ||
    messageId === `history:session-forked:${externalSessionId}` ||
    messageId === `history:system-prompt:${externalSessionId}`
  );
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
