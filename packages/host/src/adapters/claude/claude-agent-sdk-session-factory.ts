import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentSessionSummary,
  type AgentSessionTodoItem,
  InterruptedTurnResumeError,
  interruptedTurnResumeError,
} from "@openducktor/core";
import { Effect, Exit } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import {
  buildClaudeAgentSdkOptions,
  type ClaudeAgentSdkOptionsDependencies,
} from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { createClaudeNativeProcessSpawner } from "./claude-agent-sdk-native-process";
import { getClaudeCodeCompatibilityError } from "./claude-code-compatibility";
import { consumeClaudeSession } from "./claude-agent-sdk-session-io";
import { toSessionError } from "./claude-agent-sdk-session-lifecycle";
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
import {
  reconcileClaudeSessionTitle,
  renameClaudeSessionIfNeeded,
} from "./claude-session-title-update";

export type CreateClaudeAgentSdkSessionInput = {
  emit: ClaudeAgentSdkEventEmitter;
  input: ClaudeSessionInput;
  now: () => string;
  onContinuationAdmission?: () => void;
  randomId: () => string;
  initialTodos: AgentSessionTodoItem[];
  resolvedDependencies: ClaudeAgentSdkOptionsDependencies;
  runtimeId: string;
  serviceInput: CreateClaudeAgentSdkServiceInput;
  sessionInput: ClaudeSessionLaunchInput;
  sessionStore: ClaudeSessionStore;
};

export const createClaudeAgentSdkSession = async ({
  emit,
  input,
  initialTodos,
  now,
  onContinuationAdmission,
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
  // Report the saved title only after the runtime accepts the change.
  const summaryInput =
    sessionInput.reconcileTitle === true
      ? { externalSessionId: sessionInput.externalSessionId }
      : sessionInput;
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
    pendingUserTurnCount: 0,
    queue,
    runtimeId,
    startedAt,
    summary: createClaudeSessionSummary(input, summaryInput, startedAt),
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
    pendingUserMessageAdmissions: new Map(),
    unreadSteeredUserMessages: new Map(),
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
      preserveNativeSettings: sessionInput.preserveNativeSettings === true,
      claudePolicy: sessionInput.claudePolicy ?? null,
      sessionOptions,
    });
    if (options.permissionMode) sessionContext.requestedPermissionMode = options.permissionMode;
    options.spawnClaudeCodeProcess = createClaudeNativeProcessSpawner(
      sessionContext,
      options.stderr,
    );
    input.workStartGuard?.assertCurrent();
    sdkQuery = query({ prompt: queue, options });
  } catch (error) {
    abortController.abort();
    queue.close();
    throw error;
  }
  const session: ClaudeSession = Object.assign(sessionContext, { query: sdkQuery });
  sessionStore.set(session);
  const isContinuation = sessionInput.resumeInterruptedTurn === true;
  const admission = isContinuation ? Promise.withResolvers<void>() : null;
  const startupValidation = Promise.withResolvers<boolean>();
  let admissionReported = false;
  const consumeInput: Parameters<typeof consumeClaudeSession>[0] = {
    session,
    sessionStore,
    now,
    emit,
    onBackgroundFailure: serviceInput.onBackgroundFailure,
    startupValidation: startupValidation.promise,
  };
  if (admission) {
    consumeInput.onContinuationAdmission = () => {
      if (admissionReported) return;
      admissionReported = true;
      input.onWorkAccepted?.();
      admission.resolve();
      onContinuationAdmission?.();
    };
  }
  const completion = consumeClaudeSession(consumeInput);
  try {
    input.onWorkIssued?.();
    const initialization = await withTimeout(
      sdkQuery.initializationResult(),
      INIT_TIMEOUT_MS,
      "Claude Agent SDK session initialization timed out. Check Claude authentication and network connectivity.",
    );
    const compatibilityError = getClaudeCodeCompatibilityError(
      initialization,
      resolvedDependencies.claudeExecutablePath,
    );
    if (compatibilityError) throw compatibilityError;
    startupValidation.resolve(true);
    if (!isContinuation) input.onWorkAccepted?.();
    await requireClaudeOpenDucktorMcpForScope(input.sessionScope, sdkQuery, {
      externalSessionId: session.externalSessionId,
      runtimeId,
    });
    if (
      sessionInput.options.resume &&
      !sessionInput.options.forkSession &&
      sessionInput.forkSourceWorkingDirectory === undefined
    ) {
      if (sessionInput.reconcileTitle === true && !isContinuation) {
        await reconcileClaudeSessionTitle({ session, title: sessionInput.title });
      } else {
        await renameClaudeSessionIfNeeded({ session, title: sessionInput.title });
      }
    }
    if (admission) {
      await awaitClaudeContinuationAdmission({
        // A stopped stream cannot admit work, so do not wait for the admission timeout.
        admission: Promise.race([
          admission.promise,
          completion.then(
            () => {
              throw new ContinuationEndedError(session.externalSessionId);
            },
            (cause: unknown) => {
              throw new ContinuationEndedError(session.externalSessionId, cause);
            },
          ),
        ]),
        externalSessionId: session.externalSessionId,
        runtimeId,
        timeoutMs: CONTINUATION_ADMISSION_TIMEOUT_MS,
      });
      session.activity = "running";
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
    session.summary.status = isContinuation ? "running" : "idle";
    // Restoring an idle session must not move its activity time in the session list.
    if (
      sessionInput.options.resume &&
      !sessionInput.options.forkSession &&
      sessionInput.forkSourceWorkingDirectory === undefined &&
      !isContinuation
    ) {
      return session.summary;
    }
    const timestamp = now();
    if (isContinuation) {
      emit(session, {
        type: "transcript_retracted",
        externalSessionId: session.externalSessionId,
        timestamp,
        messageIds: [`claude-permission-mode:${session.externalSessionId}`],
      });
    }
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
    return session.summary;
  } catch (error) {
    startupValidation.resolve(false);
    const settled = await Effect.runPromiseExit(sessionStore.settle(session));
    if (Exit.isFailure(settled)) {
      throw toStartupError(error, toSessionError(settled.cause, "claudeRuntime.settleSession"));
    }
    throw error;
  }
};

/** A continued session must admit work before startup can report success. */
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
    const streamEnded = error instanceof ContinuationEndedError;
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

const toStartupError = (cause: unknown, cleanup: HostOperationError): HostOperationError => {
  const errors = new AggregateError([cause, cleanup], "Claude startup and settlement failed.");
  const resumeError =
    cause instanceof HostOperationError && cause.cause instanceof InterruptedTurnResumeError
      ? cause.cause
      : undefined;
  let combined: AggregateError | InterruptedTurnResumeError = errors;
  // Keep the continuation reason at the public error boundary.
  if (resumeError) {
    const detail: Parameters<typeof interruptedTurnResumeError>[0] = {
      reason: resumeError.reason,
      message: resumeError.message,
      cause: errors,
    };
    if (resumeError.nativeOutcome) detail.nativeOutcome = resumeError.nativeOutcome;
    combined = interruptedTurnResumeError(detail);
  }
  return new HostOperationError({
    operation: "claudeRuntime.createSession",
    message: `${errorMessage(cause)}\n${cleanup.message}`,
    cause: combined,
  });
};

/** Keep an early stream end distinct from an admission timeout. */
class ContinuationEndedError extends Error {
  constructor(externalSessionId: string, cause?: unknown) {
    super(`Claude session '${externalSessionId}' ended before it admitted the continuation.`, {
      cause,
    });
  }
}
