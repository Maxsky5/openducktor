import type { AgentModelSelection } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorTask } from "../support/async-side-effects";
import { createSessionMessagesState } from "../support/messages";
import { toPersistedSessionRecord } from "../support/persistence";
import { buildSessionHeaderMessages } from "../support/session-prompt";
import type {
  SessionDependencies,
  SessionStartTags,
  StartedSessionContext,
} from "./start-session.types";

export const buildInitialSession = ({
  startedCtx,
  selectedModel,
  systemPrompt,
  initialMessages,
}: {
  startedCtx: StartedSessionContext;
  selectedModel: AgentModelSelection;
  systemPrompt: string;
  initialMessages?: AgentSessionState["messages"];
}): AgentSessionState => ({
  externalSessionId: startedCtx.summary.externalSessionId,
  ...(startedCtx.summary.title ? { title: startedCtx.summary.title } : {}),
  taskId: startedCtx.taskId,
  runtimeKind: startedCtx.summary.runtimeKind,
  role: startedCtx.role,
  status: "starting",
  startedAt: startedCtx.summary.startedAt,
  workingDirectory: startedCtx.summary.workingDirectory,
  historyLoadState: "loaded",
  messages:
    initialMessages ??
    createSessionMessagesState(
      startedCtx.summary.externalSessionId,
      buildSessionHeaderMessages({
        externalSessionId: startedCtx.summary.externalSessionId,
        systemPrompt,
        startedAt: startedCtx.summary.startedAt,
      }),
    ),
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel,
});

export const persistInitialSession = async ({
  initialSession,
  session,
  tags,
}: {
  initialSession: AgentSessionState;
  session: SessionDependencies;
  tags: SessionStartTags;
}): Promise<void> => {
  await runOrchestratorTask(
    "start-session-persist-initial-session",
    async () => {
      await session.persistSessionRecord(
        initialSession.taskId,
        toPersistedSessionRecord(initialSession),
      );
    },
    { tags },
  );
};
