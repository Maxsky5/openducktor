import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { buildAgentSystemPrompt } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskDocuments } from "../runtime/runtime";

type SessionPromptTask = Pick<
  TaskCard,
  "id" | "title" | "issueType" | "status" | "aiReviewEnabled" | "description"
>;

type SessionPromptInput = {
  role: AgentRole;
  scenario: AgentScenario;
  task: SessionPromptTask;
  promptOverrides: RepoPromptOverrides;
  documents: TaskDocuments;
};

type SessionPromptContext = {
  documents: TaskDocuments;
  promptOverrides: RepoPromptOverrides;
  systemPrompt: string;
};

type LoadSessionPromptInputsInput = {
  repoPath: string;
  taskId: string;
  loadTaskDocuments: (repoPath: string, taskId: string) => Promise<TaskDocuments>;
  loadRepoPromptOverrides: (repoPath: string) => Promise<RepoPromptOverrides>;
};

type CreateSessionPromptContextInput = SessionPromptInput;

type SessionPreludeInput = {
  sessionId: string;
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
  documents,
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
      specMarkdown: documents.specMarkdown,
      planMarkdown: documents.planMarkdown,
      latestQaReportMarkdown: documents.qaMarkdown,
    },
    overrides: promptOverrides,
  });

export const loadSessionPromptInputs = async ({
  repoPath,
  taskId,
  loadTaskDocuments,
  loadRepoPromptOverrides,
}: LoadSessionPromptInputsInput): Promise<
  Pick<SessionPromptContext, "documents" | "promptOverrides">
> => {
  const [documents, promptOverrides] = await Promise.all([
    loadTaskDocuments(repoPath, taskId),
    loadRepoPromptOverrides(repoPath),
  ]);

  return {
    documents,
    promptOverrides,
  };
};

export const createSessionPromptContext = ({
  role,
  scenario,
  task,
  promptOverrides,
  documents,
}: CreateSessionPromptContextInput): SessionPromptContext => {
  return {
    documents,
    promptOverrides,
    systemPrompt: buildSessionSystemPrompt({
      role,
      scenario,
      task,
      promptOverrides,
      documents,
    }),
  };
};

export const loadSessionPromptContext = async ({
  repoPath,
  taskId,
  role,
  scenario,
  task,
  loadTaskDocuments,
  loadRepoPromptOverrides,
}: LoadSessionPromptInputsInput & {
  role: AgentRole;
  scenario: AgentScenario;
  task: SessionPromptTask;
}): Promise<SessionPromptContext> => {
  const { documents, promptOverrides } = await loadSessionPromptInputs({
    repoPath,
    taskId,
    loadTaskDocuments,
    loadRepoPromptOverrides,
  });

  return createSessionPromptContext({
    role,
    scenario,
    task,
    promptOverrides,
    documents,
  });
};

export const buildSessionPreludeMessages = ({
  sessionId,
  role,
  scenario,
  systemPrompt,
  startedAt,
  eventLabel = "started",
  includeSystemPrompt = true,
}: SessionPreludeInput): AgentSessionState["messages"] => {
  const eventId = eventLabel === "started" ? "start" : eventLabel;
  const messages: AgentSessionState["messages"] = [
    {
      id: `history:session-${eventId}:${sessionId}`,
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
      id: `history:system-prompt:${sessionId}`,
      role: "system",
      content: `System prompt:\n\n${systemPrompt}`,
      timestamp: startedAt,
    },
  ];
};
