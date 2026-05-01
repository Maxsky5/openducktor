import type { AgentModelSelection } from "@openducktor/core";
import { createRepoScopedAgentSessionState } from "@/state/repo-scoped-agent-session";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { requireConfiguredRuntimeKind } from "../runtime/runtime";
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
}): AgentSessionState =>
  createRepoScopedAgentSessionState(
    {
      externalSessionId: startedCtx.summary.externalSessionId,
      taskId: startedCtx.taskId,
      runtimeKind: requireConfiguredRuntimeKind(
        runtime.runtimeKind ?? selectedModel?.runtimeKind,
        `Runtime kind is required to initialize ${startedCtx.role} sessions.`,
      ),
      role: startedCtx.role,
      status: "starting",
      startedAt: startedCtx.summary.startedAt,
      runtimeId: runtime.runtimeId,
      workingDirectory: runtime.workingDirectory,
      historyHydrationState: "hydrated",
      runtimeRecoveryState: "idle",
      messages:
        initialMessages ??
        buildSessionHeaderMessages({
          externalSessionId: startedCtx.summary.externalSessionId,
          role: startedCtx.role,
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
    },
    startedCtx.repoPath,
  );

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
