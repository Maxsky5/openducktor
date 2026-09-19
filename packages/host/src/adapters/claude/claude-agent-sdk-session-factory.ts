import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { type AgentSessionSummary, type AgentSessionTodoItem } from "@openducktor/core";
import { interruptedTurnResumeError } from "@openducktor/core";
import { HostOperationError } from "../../effect/host-errors";
import {
  buildClaudeAgentSdkOptions,
  type ClaudeAgentSdkOptionsDependencies,
} from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { consumeClaudeSession, renameClaudeSessionIfNeeded } from "./claude-agent-sdk-session-io";
import {
  type ClaudeSessionLaunchInput,
  requireClaudeOpenDucktorMcpForScope,
} from "./claude-agent-sdk-session-policy";
import { createClaudeSessionSummary } from "./claude-agent-sdk-session-shape";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  ClaudeSessionContext,
  ClaudeSessionInput,
  ClaudeSessionStore,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import {
  CONTINUATION_ADMISSION_TIMEOUT_MS,
  INIT_TIMEOUT_MS,
  withTimeout,
} from "./claude-agent-sdk-utils";

export type CreateClaudeAgentSdkSessionInput = {
  emit: ClaudeAgentSdkEventEmitter;
  input: ClaudeSessionInput;
  now: () => string;
  randomId: () => string;
  initialTodos: AgentSessionTodoItem[];
  resolvedDependencies: ClaudeAgentSdkOptionsDependencies;
  runtimeId: string;
  serviceInput: CreateClaudeAgentSdkServiceInput;
  sessionInput: ClaudeSessionLaunchInput;
  sessionStore: ClaudeSessionStore;
};

/** Distinguishes a stream that ended before admission from an admission timeout. */
class ClaudeContinuationStreamEndedError extends Error {
  constructor(externalSessionId: string) {
    super(`Claude session '${externalSessionId}' ended before it admitted the continuation.`);
  }
}

/**
 * Blocks until the resumed session admits the interrupted-turn continuation.
 * The CLI fails closed when it never starts the hidden continuation turn.
 */
export const awaitClaudeContinuationAdmission = async (input: {
  admission: Promise<void>;
  externalSessionId: string;
  runtimeId: string;
  timeoutMs: number;
}): Promise<void> => {
  try {
    await withTimeout(
      input.admission,
      input.timeoutMs,
      `Claude session '${input.externalSessionId}' did not start the interrupted-turn continuation.`,
    );
  } catch (error) {
    const streamEnded = error instanceof ClaudeContinuationStreamEndedError;
    throw new HostOperationError({
      operation: "claudeRuntime.createSession",
      message: streamEnded
        ? `Claude session '${input.externalSessionId}' ended before it admitted the interrupted-turn continuation.`
        : `Claude session '${input.externalSessionId}' did not start the interrupted-turn continuation within ${input.timeoutMs} ms.`,
      cause: interruptedTurnResumeError({
        reason: "continuation_failed",
        message: streamEnded
          ? `Claude Code ended session '${input.externalSessionId}' before it started the continuation. Send a new message to continue.`
          : `Claude Code did not start the continuation for session '${input.externalSessionId}'. Send a new message to continue.`,
        cause: error,
      }),
      details: {
        externalSessionId: input.externalSessionId,
        runtimeId: input.runtimeId,
      },
    });
  }
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
  if (sessionInput.parentExternalSessionId) {
    sessionContext.parentExternalSessionId = sessionInput.parentExternalSessionId;
  }
  let sdkQuery: ReturnType<typeof query>;
  try {
    const sessionOptions: CreateClaudeAgentSdkSessionInput["sessionInput"]["options"] & {
      title?: string;
    } = { ...sessionInput.options };
    if (sessionInput.title) {
      sessionOptions.title = sessionInput.title;
    }
    const options = await buildClaudeAgentSdkOptions({
      input,
      session: sessionContext,
      serviceInput,
      now,
      randomId,
      resolvedDependencies,
      emit,
      resumeInterruptedTurn: sessionInput.resumeInterruptedTurn === true,
      sessionOptions,
    });
    sdkQuery = query({ prompt: queue, options });
  } catch (error) {
    abortController.abort();
    queue.close();
    throw error;
  }
  const session: ClaudeSession = Object.assign(sessionContext, { query: sdkQuery });
  sessionStore.set(session);
  const isContinuation = sessionInput.resumeInterruptedTurn === true;
  const continuationAdmission = isContinuation ? Promise.withResolvers<void>() : null;
  const consumptionInput: Parameters<typeof consumeClaudeSession>[0] = {
    session,
    sessionStore,
    now,
    emit,
    onBackgroundFailure: serviceInput.onBackgroundFailure,
  };
  if (continuationAdmission) {
    consumptionInput.onContinuationAdmission = () => continuationAdmission.resolve();
  }
  const consumption = consumeClaudeSession(consumptionInput);
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
    if (continuationAdmission) {
      await awaitClaudeContinuationAdmission({
        // Race the admission against the stream itself, so a stream that ends first
        // reports its own failure instead of waiting for the admission timeout.
        admission: Promise.race([
          continuationAdmission.promise,
          consumption.then(() => {
            throw new ClaudeContinuationStreamEndedError(session.externalSessionId);
          }),
        ]),
        externalSessionId: session.externalSessionId,
        runtimeId,
        timeoutMs: CONTINUATION_ADMISSION_TIMEOUT_MS,
      });
      session.activity = "running";
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
  summary.status = isContinuation ? "running" : "idle";
  const timestamp = now();
  emit(session, {
    type: "session_started",
    externalSessionId: session.externalSessionId,
    timestamp,
    message: sessionInput.startedMessage,
  });
  if (!isContinuation) {
    emit(session, {
      type: "session_idle",
      externalSessionId: session.externalSessionId,
      timestamp,
    });
  }
  return summary;
};
