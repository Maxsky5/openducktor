import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AcceptedAgentUserMessage, AgentModelSelection } from "@openducktor/core";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import { beginClaudeManualCompaction } from "./claude-agent-sdk-compaction";
import {
  assertClaudeSessionModelUpdateSupported,
  assertSupportedClaudeLiveEffort,
} from "./claude-agent-sdk-session-model";
import { canFlushQueuedClaudeUserMessage } from "./claude-agent-sdk-session-queue-policy";
import { isClaudeSessionStopped } from "./claude-agent-sdk-session-store";
import { prepareClaudeTurnSpeed } from "./claude-session-speed-preparation";
import type { ClaudeAgentSdkEventEmitter, ClaudeSession } from "./claude-agent-sdk-types";

export const assertClaudeSessionAcceptingMessages = (session: ClaudeSession): void => {
  if (session.activity !== "stopped") {
    return;
  }
  throw new HostValidationError({
    field: "externalSessionId",
    message:
      "Claude Agent SDK session is no longer accepting messages after its SDK stream stopped.",
    details: {
      externalSessionId: session.externalSessionId,
      activity: session.activity,
    },
  });
};

export const pushClaudeSdkUserMessage = (session: ClaudeSession, message: SDKUserMessage): void => {
  session.activeSdkUserTurnCount += 1;
  session.sdkState = "running";
  try {
    session.queue.push(message);
  } catch (error) {
    session.activeSdkUserTurnCount -= 1;
    throw error;
  }
};

export const applyClaudeSessionModel = async (
  session: ClaudeSession,
  model: AgentModelSelection | null | undefined,
  force = false,
): Promise<void> => {
  assertClaudeSessionAcceptingMessages(session);
  const nextModel = model ?? undefined;
  assertClaudeSessionModelUpdateSupported(session, nextModel);

  const previousModel = session.model;
  const modelChanged =
    force ||
    session.preserveNativeSettings === true ||
    previousModel?.modelId !== nextModel?.modelId;
  // Before the first report, an explicit choice must replace unknown native effort.
  const effortChanged =
    force ||
    (session.preserveNativeSettings === true && session.nativeModel === undefined) ||
    previousModel?.variant !== nextModel?.variant;
  try {
    if (modelChanged) {
      await session.query.setModel(nextModel?.modelId);
      assertClaudeSessionAcceptingMessages(session);
    }
    if (effortChanged) {
      await session.query.applyFlagSettings({
        effortLevel: nextModel
          ? assertSupportedClaudeLiveEffort(nextModel, session.externalSessionId)
          : null,
      });
      assertClaudeSessionAcceptingMessages(session);
    }
  } catch (cause) {
    if (isClaudeSessionStopped(session)) {
      throw cause;
    }
    const rollbackFailures: string[] = [];
    if (effortChanged) {
      try {
        await session.query.applyFlagSettings({
          effortLevel: previousModel
            ? assertSupportedClaudeLiveEffort(previousModel, session.externalSessionId)
            : null,
        });
      } catch (rollbackCause) {
        rollbackFailures.push(`effort: ${errorMessage(rollbackCause)}`);
      }
    }
    if (modelChanged) {
      try {
        await session.query.setModel(previousModel?.modelId);
      } catch (rollbackCause) {
        rollbackFailures.push(`model: ${errorMessage(rollbackCause)}`);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new HostOperationError({
        operation: "claude.session.model.update",
        message: `Claude model update failed and rollback was incomplete: ${rollbackFailures.join(
          "; ",
        )}`,
        cause,
        details: {
          externalSessionId: session.externalSessionId,
          rollbackFailures,
        },
      });
    }
    throw cause;
  }
  session.model = nextModel;
  session.preserveNativeSettings = false;
};

export const restoreClaudeSessionModelAfterQueuedTurns = async (
  session: ClaudeSession,
  emit: ClaudeAgentSdkEventEmitter,
  timestamp: string,
): Promise<void> => {
  await session.turnAdmission.run(async () => {
    const model = session.modelAfterQueuedTurns;
    if (model === undefined) return;
    await applyClaudeSessionModel(session, model);
    await prepareClaudeTurnSpeed(session, emit, timestamp);
    delete session.modelAfterQueuedTurns;
  });
};

export const rollbackClaudeSessionModel = async (input: {
  cause: unknown;
  operation: string;
  previousModel: AgentModelSelection | undefined;
  session: ClaudeSession;
}): Promise<void> => {
  const { cause, operation, previousModel, session } = input;
  try {
    await applyClaudeSessionModel(session, previousModel);
  } catch (rollbackCause) {
    throw new HostOperationError({
      operation,
      message: `Claude message delivery failed and model rollback was incomplete: ${errorMessage(rollbackCause)}`,
      cause,
      details: {
        externalSessionId: session.externalSessionId,
        rollbackFailure: errorMessage(rollbackCause),
      },
    });
  }
};

export const flushQueuedClaudeUserMessage = (input: {
  emit: ClaudeAgentSdkEventEmitter;
  now: () => string;
  session: ClaudeSession;
}): Promise<void> => {
  const { emit, now, session } = input;
  if (!canFlushQueuedClaudeUserMessage(session)) {
    return Promise.resolve();
  }
  const nextMessage = session.queuedSdkMessages[0];
  if (!nextMessage) {
    return Promise.resolve();
  }
  const timestamp = now();
  const previousActivity = session.activity;
  const previousSdkState = session.sdkState;
  session.activity = "running";
  const acceptedMessage = session.acceptedUserMessages.find(
    (message) => message.messageId === nextMessage.uuid,
  );
  const previousModel = session.model;
  const previousModelAfterQueuedTurns = session.modelAfterQueuedTurns;
  let modelApplied = false;
  let removedFromQueue = false;
  const dispatch = () =>
    Promise.resolve()
      .then(async () => {
        if (acceptedMessage?.model) {
          if (session.modelAfterQueuedTurns === undefined) {
            session.modelAfterQueuedTurns = previousModel ?? null;
          }
          await applyClaudeSessionModel(session, acceptedMessage.model);
          modelApplied = true;
        }
        await prepareClaudeTurnSpeed(session, emit, timestamp);
        assertClaudeSessionAcceptingMessages(session);
        if (session.queuedSdkMessages[0] !== nextMessage) {
          throw new HostOperationError({
            operation: "claudeRuntime.flushQueuedUserMessage",
            message: `Claude session '${session.externalSessionId}' user-message queue changed while preparing its next message.`,
            details: { externalSessionId: session.externalSessionId },
          });
        }
        session.queuedSdkMessages.shift();
        removedFromQueue = true;
        pushClaudeSdkUserMessage(session, nextMessage);
        if (acceptedMessage?.isManualCompaction) {
          beginClaudeManualCompaction({
            session,
            timestamp,
            messageId: acceptedMessage.messageId,
            emit: (event) => emit(session, event),
          });
        }
      })
      .then(() => {
        assertClaudeSessionAcceptingMessages(session);
        if (acceptedMessage && !acceptedMessage.isManualCompaction) {
          const acceptedEvent: AcceptedAgentUserMessage = {
            type: "user_message",
            externalSessionId: session.externalSessionId,
            timestamp,
            messageId: acceptedMessage.messageId,
            message: acceptedMessage.text,
            parts: acceptedMessage.parts,
            state: "read",
          };
          if (acceptedMessage.model) {
            acceptedEvent.model = acceptedMessage.model;
          }
          emit(session, acceptedEvent);
        }
        emit(session, {
          type: "session_status",
          externalSessionId: session.externalSessionId,
          timestamp,
          status: { type: "busy", message: null },
        });
      })
      .catch(async (cause) => {
        if (session.activity === "stopped") {
          throw cause;
        }
        if (removedFromQueue) {
          session.queuedSdkMessages.unshift(nextMessage);
        }
        session.activity = previousActivity;
        if (previousSdkState === undefined) {
          delete session.sdkState;
        } else {
          session.sdkState = previousSdkState;
        }
        if (modelApplied) {
          await rollbackClaudeSessionModel({
            cause,
            operation: "claudeRuntime.flushQueuedUserMessage",
            previousModel,
            session,
          });
        } else {
          session.model = previousModel;
        }
        if (previousModelAfterQueuedTurns === undefined) {
          delete session.modelAfterQueuedTurns;
        } else {
          session.modelAfterQueuedTurns = previousModelAfterQueuedTurns;
        }
        throw cause;
      });
  return session.turnAdmission.run(dispatch);
};
