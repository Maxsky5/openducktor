import type { AgentModelSelection } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorTask } from "../support/async-side-effects";
import { toPersistedSessionRecord } from "../support/persistence";
import { buildSessionHeaderMessages } from "../support/session-prompt";
import type {
  ResolvedRuntimeAndModel,
  SessionDependencies,
  SessionStartTags,
  StartedSessionContext,
} from "./start-session.types";

export const buildInitialSession = ({
  startedCtx,
  selectedModel,
  runtime,
  systemPrompt,
  promptOverrides,
  initialMessages,
}: {
  startedCtx: StartedSessionContext;
  selectedModel: AgentModelSelection;
  runtime: ResolvedRuntimeAndModel["runtime"];
  systemPrompt: string;
  promptOverrides: ResolvedRuntimeAndModel["promptOverrides"];
  initialMessages?: AgentSessionState["messages"];
}): AgentSessionState => ({
  sessionId: startedCtx.summary.sessionId,
  externalSessionId: startedCtx.summary.externalSessionId,
  taskId: startedCtx.taskId,
  runtimeKind: runtime.runtimeKind ?? selectedModel?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
  role: startedCtx.role,
  scenario: startedCtx.resolvedScenario,
  status: "starting",
  startedAt: startedCtx.summary.startedAt,
  runtimeId: runtime.runtimeId,
  runId: runtime.runId,
  runtimeRoute: runtime.runtimeRoute,
  workingDirectory: runtime.workingDirectory,
  historyHydrationState: "hydrated",
  runtimeRecoveryState: "idle",
  messages:
    initialMessages ??
    buildSessionHeaderMessages({
      sessionId: startedCtx.summary.sessionId,
      role: startedCtx.role,
      scenario: startedCtx.resolvedScenario,
      systemPrompt,
      startedAt: startedCtx.summary.startedAt,
    }),
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel,
  isLoadingModelCatalog: true,
  promptOverrides,
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
