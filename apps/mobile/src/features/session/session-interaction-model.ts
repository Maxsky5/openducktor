import type { RuntimeReadinessSnapshot } from "@openducktor/frontend-core/lib/runtime-readiness";

export type SessionInteractionInput = {
  readOnly: boolean;
  /** True when the saved chat is archived. */
  archived: boolean;
  /** The command gate of the host connection. */
  gateOpen: boolean;
  runtimeReadiness: Pick<RuntimeReadinessSnapshot, "state" | "message">;
  readModelReady: boolean;
  /** The failure of the session read model of the workspace, or null. */
  readModelFailure: string | null;
  sessionPresent: boolean;
  /** A fault that the session read model reports for this session, or null. */
  faultMessage: string | null;
  preparation: { ready: boolean; error: string | null };
};

export type SessionInteractionState = {
  canInteract: boolean;
  blockedReason: string | null;
  isPreparing: boolean;
  /**
   * True when the screen already shows the reason in its own place: the transcript, the
   * connection banner, the composer placeholder, the turning Send button, or the failure row with
   * Retry. Otherwise the error row above the composer shows it.
   */
  reasonShown: boolean;
};

/**
 * Decides whether the session takes host commands now, and why not. The first reason that
 * applies wins, so the user sees the step to take first.
 */
export const resolveSessionInteraction = (
  input: SessionInteractionInput,
): SessionInteractionState => {
  const blocked = (
    reason: string,
    { isPreparing = false, reasonShown = false } = {},
  ): SessionInteractionState => ({
    canInteract: false,
    blockedReason: reason,
    isPreparing,
    reasonShown,
  });
  if (input.readOnly) return blocked("This is a read-only view of a Subagent session.");
  // The composer placeholder says that the chat is archived.
  if (input.archived) {
    return blocked("This chat is archived. Restore it to send messages.", { reasonShown: true });
  }
  // The connection banner of the screen says that the host is not connected.
  if (!input.gateOpen) {
    return blocked("Reconnect to the host to send messages.", { reasonShown: true });
  }
  if (input.runtimeReadiness.state === "blocked") {
    return blocked(
      input.runtimeReadiness.message ?? "The runtime of this session is not available.",
    );
  }
  if (input.runtimeReadiness.state === "checking") {
    return blocked("Checking the runtime.", { reasonShown: true });
  }
  if (input.readModelFailure) return blocked(input.readModelFailure, { reasonShown: true });
  if (!input.readModelReady || !input.sessionPresent) {
    return blocked("Loading the session.", { reasonShown: true });
  }
  // The host writes a session fault and a failed preparation into the transcript as an error.
  if (input.faultMessage) return blocked(input.faultMessage, { reasonShown: true });
  if (input.preparation.error) return blocked(input.preparation.error, { reasonShown: true });
  // The Send button turns while the session gets ready.
  if (!input.preparation.ready) {
    return blocked("Getting the session ready.", { isPreparing: true, reasonShown: true });
  }
  return { canInteract: true, blockedReason: null, isPreparing: false, reasonShown: false };
};
