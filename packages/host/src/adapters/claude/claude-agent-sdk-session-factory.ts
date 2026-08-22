import { type Options, query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionSummary, AgentSessionTodoItem } from "@openducktor/core";
import { HostOperationError } from "../../effect/host-errors";
import {
  buildClaudeAgentSdkOptions,
  type ClaudeAgentSdkOptionsDependencies,
} from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { consumeClaudeSession, renameClaudeSessionIfNeeded } from "./claude-agent-sdk-session-io";
import { requireClaudeOpenDucktorMcpForScope } from "./claude-agent-sdk-session-policy";
import { createClaudeSessionSummary } from "./claude-agent-sdk-session-shape";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionContext,
  ClaudeSessionInput,
  ClaudeSessionStore,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { INIT_TIMEOUT_MS, withTimeout } from "./claude-agent-sdk-utils";

export type CreateClaudeAgentSdkSessionInput = {
  emit: ClaudeAgentSdkEventEmitter;
  input: ClaudeSessionInput;
  now: () => string;
  randomId: () => string;
  initialTodos: AgentSessionTodoItem[];
  resolvedDependencies: ClaudeAgentSdkOptionsDependencies;
  runtimeId: string;
  serviceInput: CreateClaudeAgentSdkServiceInput;
  sessionInput: {
    externalSessionId: string;
    options: Pick<Options, "forkSession" | "resume" | "sessionId">;
    parentExternalSessionId?: string;
    startedMessage: string;
    title?: string;
  };
  sessionStore: ClaudeSessionStore;
};

export const createClaudeAgentSdkSession = async ({
  emit,
  input,
  initialTodos,
  now,
  randomId,
  resolvedDependencies,
  runtimeId,
  serviceInput,
  sessionInput,
  sessionStore,
}: CreateClaudeAgentSdkSessionInput): Promise<AgentSessionSummary> => {
  const queue = new AsyncInputQueue<SDKUserMessage>();
  const abortController = new AbortController();
  const startedAt = now();
  const summary = createClaudeSessionSummary(input, sessionInput, startedAt);
  const sessionContext: ClaudeSessionContext = {
    acceptedUserMessages: [],
    activeSdkUserTurnCount: 0,
    abortController,
    activity: "idle",
    externalSessionId: sessionInput.externalSessionId,
    input,
    model: input.model,
    ...(() => {
      if (sessionInput.parentExternalSessionId) {
        return { parentExternalSessionId: sessionInput.parentExternalSessionId };
      }
      return {};
    })(),
    pendingApprovals: new Map(),
    pendingQuestions: new Map(),
    queuedSdkMessages: [],
    pendingUserTurnCount: 0,
    queue,
    runtimeId,
    startedAt,
    summary,
    streamAssistantMessageOrdinal: 0,
    streamAssistantMessageIdsByBlockIndex: new Map(),
    subagentMessageIdsByTaskId: new Map(),
    subagentTaskIdsByToolUseId: new Map(),
    toolEndedAtMsByCallId: new Map(),
    toolInputsByCallId: new Map(),
    toolMessageIdsByCallId: new Map(),
    toolNamesByCallId: new Map(),
    toolStartedAtMsByCallId: new Map(),
    todosById: new Map(initialTodos.map((todo) => [todo.id, todo])),
  };
  let sdkQuery: ReturnType<typeof query>;
  try {
    const options = await buildClaudeAgentSdkOptions({
      input,
      session: sessionContext,
      serviceInput,
      now,
      randomId,
      resolvedDependencies,
      emit,
      sessionOptions: {
        ...sessionInput.options,
        ...(() => {
          if (sessionInput.title) {
            return { title: sessionInput.title };
          }
          return {};
        })(),
      },
    });
    sdkQuery = query({ prompt: queue, options });
  } catch (error) {
    abortController.abort();
    queue.close();
    throw error;
  }
  const session: ClaudeSession = Object.assign(sessionContext, { query: sdkQuery });
  sessionStore.set(session);
  const consumption = consumeClaudeSession({
    session,
    sessionStore,
    now,
    emit,
    onBackgroundFailure: serviceInput.onBackgroundFailure,
  });
  try {
    await withTimeout(
      sdkQuery.initializationResult(),
      INIT_TIMEOUT_MS,
      "Claude Agent SDK session initialization timed out. Check Claude authentication and network connectivity.",
    );
    await requireClaudeOpenDucktorMcpForScope(input.sessionScope, sdkQuery, {
      externalSessionId: session.externalSessionId,
      runtimeId,
    });
    if (sessionInput.options.resume && !sessionInput.options.forkSession) {
      await renameClaudeSessionIfNeeded({
        session,
        title: sessionInput.title,
      });
    }
  } catch (error) {
    if (sessionStore.get(session.externalSessionId) === session) {
      sessionStore.close(session);
    }
    await sdkQuery.return();
    await consumption;
    throw error;
  }
  if (sessionStore.get(session.externalSessionId) !== session) {
    throw new HostOperationError({
      operation: "claudeRuntime.createSession",
      message: `Claude session '${session.externalSessionId}' stopped before startup completed.`,
      details: {
        externalSessionId: session.externalSessionId,
        runtimeId,
      },
    });
  }
  summary.status = "idle";
  const timestamp = now();
  emit(session, {
    type: "session_started",
    externalSessionId: session.externalSessionId,
    timestamp,
    message: sessionInput.startedMessage,
  });
  emit(session, {
    type: "session_idle",
    externalSessionId: session.externalSessionId,
    timestamp,
  });
  return summary;
};
