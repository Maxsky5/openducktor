import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentSessionMessageAcceptanceUnknownError,
  AgentSessionMessageRefusedError,
} from "@openducktor/core";
import { z } from "zod";
import { toClaudeUserMessageEvent } from "./claude-agent-sdk-session-shape";
import type { ClaudeAgentSdkEvent, ClaudeSession } from "./claude-agent-sdk-types";

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
}: {
  emit: (event: ClaudeAgentSdkEvent) => void;
  message: SDKMessage | CommandLifecycleFrame;
  session: ClaudeSession;
}): boolean => {
  const signal = readUserMessageSignal(message);
  if (!signal) return false;
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
 * A lifecycle or replay signal admits a user message, and only a replay shows that a turn read
 * it. Any lifecycle state other than `cancelled` proves that the CLI took the message.
 */
type UserMessageSignal = {
  readonly messageId: string;
  readonly kind: "lifecycle" | "cancelled" | "replay";
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
    kind: lifecycle.data.state === "cancelled" ? "cancelled" : "lifecycle",
  };
};
