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
  ...(() => {
    if (startedCtx.summary.title) {
      return { title: startedCtx.summary.title };
    }
    return {};
  })(),
  sessionAssociation: {
    kind: "workflow",
    taskId: startedCtx.taskId,
    role: startedCtx.role,
  },
  runtimeKind: startedCtx.summary.runtimeKind,
  status: startedCtx.holdForPostStartMessage ? "starting" : "idle",
  runtimeStatusMessage: null,
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
      if (initialSession.sessionAssociation.kind !== "workflow") {
        throw new Error(
          `Cannot persist initial session '${initialSession.externalSessionId}' because its association is ${initialSession.sessionAssociation.kind}.`,
        );
      }
      await session.persistSessionRecord(
        initialSession.sessionAssociation.taskId,
        toPersistedSessionRecord(initialSession),
      );
    },
    { tags },
  );
};
