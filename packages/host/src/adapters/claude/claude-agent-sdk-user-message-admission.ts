import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionMessageRefusedError,
} from "@openducktor/core";
import { z } from "zod";
import { toClaudeUserMessageEvent } from "./claude-agent-sdk-session-shape";
import type { ClaudeAgentSdkEvent, ClaudeSession } from "./claude-agent-sdk-types";
import { applyClaudeLifecycleEvent } from "./claude-agent-sdk-lifecycle";

/**
 * Applies a CLI signal about a user message. It admits a pending send, or refuses it when the
 * CLI cancelled the message before it ran. A replay marks a steered message read. It returns
 * true when the frame is a signal. A signal needs no other handling, because a replay is never
 * new transcript content.
 */
export const applyClaudeUserMessageSignal = ({
  emit,
  message,
  session,
  timestamp = new Date().toISOString(),
}: {
  emit: (event: ClaudeAgentSdkEvent) => void;
  message: SDKMessage | CommandLifecycleFrame;
  session: ClaudeSession;
  timestamp?: string;
}): boolean => {
  const signal = readUserMessageSignal(message);
  if (!signal) return false;
  const previousState = session.nativeCommandStates?.get(signal.messageId);
  const acceptedIndex = session.acceptedUserMessages.findIndex(
    (accepted) => accepted.messageId === signal.messageId,
  );
  const knownMessage =
    acceptedIndex !== -1 || session.nativeSubmittedMessageIds?.has(signal.messageId);
  if (signal.kind === "lifecycle" && knownMessage && previousState === undefined) {
    session.nativeCommandStates ??= new Map();
    session.nativeCommandStates.set(signal.messageId, "queued");
  }
  if (
    signal.kind === "started" &&
    previousState !== "result" &&
    previousState !== "terminal" &&
    knownMessage
  ) {
    session.foregroundMessageIds ??= new Set();
    session.foregroundMessageIds.add(signal.messageId);
    session.foregroundTurnActive = true;
    session.nativeCommandStates ??= new Map();
    session.nativeCommandStates.set(signal.messageId, "started");
  }
  if (
    knownMessage &&
    (signal.kind === "cancelled" || signal.kind === "terminal") &&
    previousState !== "result"
  ) {
    session.nativeCommandStates ??= new Map();
    session.nativeCommandStates.set(signal.messageId, "terminal");
  }
  const admission = session.pendingUserMessageAdmissions.get(signal.messageId);
  if (admission) {
    session.pendingUserMessageAdmissions.delete(signal.messageId);
    if (signal.kind === "cancelled") {
      admission.reject(
        new AgentSessionMessageRefusedError(
          new Error("Claude cancelled the message before it ran."),
        ),
      );
    } else {
      admission.admit();
    }
  }
  if (!admission && signal.kind === "cancelled" && previousState === "queued" && knownMessage) {
    emit({
      type: "turn_error",
      externalSessionId: session.externalSessionId,
      timestamp,
      messageId: signal.messageId,
      message:
        "Claude cancelled the accepted message before its turn started. Resume the queue to send the next prompt.",
    });
    if (acceptedIndex !== -1) {
      session.acceptedUserMessages.splice(acceptedIndex, 1);
      applyClaudeLifecycleEvent({
        emit,
        session,
        timestamp,
        event: { kind: "user_turn_cancelled" },
      });
    }
    session.unreadSteeredUserMessages.delete(signal.messageId);
  }
  const steered =
    signal.kind === "replay" ? session.unreadSteeredUserMessages.get(signal.messageId) : undefined;
  if (steered) {
    session.unreadSteeredUserMessages.delete(signal.messageId);
    emit(toClaudeUserMessageEvent(session, steered, "read"));
  }
  return true;
};

/** Waits for the CLI signal that admits the message. Register it before the adapter sends it. */
export const waitForUserMessageAdmission = (
  session: ClaudeSession,
  messageId: string,
): AdmissionWait => {
  session.nativeSubmittedMessageIds ??= new Set();
  session.nativeSubmittedMessageIds.add(messageId);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  session.pendingUserMessageAdmissions.set(messageId, { admit: resolve, reject });
  return {
    admitted: promise,
    dispose: () => session.pendingUserMessageAdmissions.delete(messageId),
  };
};

/** The CLI stopped before it admitted these messages, so their delivery is unknown. */
export const rejectPendingAdmissions = (session: ClaudeSession, reason: Error): void => {
  const pending = [...session.pendingUserMessageAdmissions];
  session.pendingUserMessageAdmissions.clear();
  for (const [messageId, admission] of pending) {
    admission.reject(
      new AgentSessionMessageAcceptanceUnknownError({
        externalSessionId: session.externalSessionId,
        messageId,
        cause: reason,
      }),
    );
  }
};

type AdmissionWait = {
  /**
   * Resolves when the CLI admits the message. It rejects with
   * `AgentSessionMessageAcceptanceUnknownError` when the stream stops first.
   */
  readonly admitted: Promise<void>;
  /** Stops the wait when the message never left the adapter. */
  readonly dispose: () => void;
};

/**
 * The CLI sends `queued` when it takes a user message from its input, then `started` when a
 * turn reads it. A terminal `cancelled` means that the message will never run. The SDK message
 * types do not list this frame; the SDK documents the `cancelled` state with interrupts.
 */
const commandLifecycleFrameSchema = z.object({
  type: z.literal("command_lifecycle"),
  command_uuid: z.string().min(1),
  state: z.string(),
});
type CommandLifecycleFrame = z.infer<typeof commandLifecycleFrameSchema>;

/**
 * A queued or started signal admits a user message. A started signal or replay identifies a
 * consumed message. Cancellation, discard, and refusal can end a send before a turn starts.
 */
type UserMessageSignal = {
  readonly messageId: string;
  readonly kind: "lifecycle" | "started" | "cancelled" | "terminal" | "replay";
};

const readUserMessageSignal = (
  message: SDKMessage | CommandLifecycleFrame,
): UserMessageSignal | null => {
  if (message.type === "user" && "isReplay" in message && message.isReplay) {
    return { messageId: message.uuid, kind: "replay" };
  }
  const lifecycle = commandLifecycleFrameSchema.safeParse(message);
  if (!lifecycle.success) return null;
  return {
    messageId: lifecycle.data.command_uuid,
    kind: ["cancelled", "discarded", "refused"].includes(lifecycle.data.state)
      ? "cancelled"
      : lifecycle.data.state === "completed"
        ? "terminal"
        : lifecycle.data.state === "started"
          ? "started"
          : "lifecycle",
  };
};
