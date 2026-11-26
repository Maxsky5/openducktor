import {
  HANDOFF_ATTEMPT_MISSING,
  type AgentChatHandoffResult,
  type AgentChatRef,
  type AgentSessionModelSelection,
  type AgentSessionUserMessagePart,
  type HandoffLink,
  type SessionOperationObservation,
} from "@openducktor/contracts";
import { HostInvokeError, type HostClient } from "@openducktor/host-client";
import { isHostInvocationRefused } from "@openducktor/host-client/channel";
import { matchesAgentSessionIdentity } from "../../lib/agent-session-identity";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { AgentSessionsStore } from "../agent-sessions-store";
import type { PendingHandoffSend } from "./agent-chat-send-result";

type HandoffReply = {
  hostEpoch: string | null;
  response?: SessionOperationObservation | undefined;
  error?: string | undefined;
};

export type HandoffDeliveryState = {
  reply?: HandoffReply | undefined;
  attempt?: LocalHandoff | undefined;
  hideSettled?: boolean;
};

export type HandoffDeliverySnapshot = {
  latest: SessionOperationObservation | undefined;
  reply: HandoffReply | undefined;
  waitingForLocalDraft: boolean;
  blocked: boolean;
  pending: boolean;
};

type LocalHandoff = PendingHandoffSend & {
  id: string;
  hostEpoch: string;
  sendFinished: Promise<void>;
  settleFrom: (result: SessionOperationObservation | undefined) => void;
  settleUnsent: () => void;
};

type HandoffDeliveryCommands = {
  send: (
    destination: AgentSessionModelSelection,
    parts: AgentSessionUserMessagePart[],
  ) => Promise<boolean | PendingHandoffSend>;
  check: () => Promise<void>;
};

export function handoffReplyForHost(
  state: HandoffDeliveryState,
  hostEpoch: string | null,
): HandoffReply | undefined {
  return state.reply?.hostEpoch === hostEpoch ? state.reply : undefined;
}

const replacedHost = (before: string | null, after: string | null): boolean =>
  before !== null && after !== null && before !== after;

function latestHandoff(
  observed: SessionOperationObservation | undefined,
  state: HandoffDeliveryState,
  response: SessionOperationObservation | undefined,
): SessionOperationObservation | undefined {
  const current = state.attempt?.id;
  if (current && observed?.submissionId !== current) return response;
  if (observed && response && response.submissionId === observed.submissionId) {
    return deliveryStage(observed) > deliveryStage(response) ? observed : response;
  }
  if (observed && isUnresolved(observed)) return observed;
  return state.hideSettled ? undefined : (response ?? observed);
}

const isUnresolved = (result: SessionOperationObservation): boolean =>
  !result.handoff?.committed &&
  (result.pending || result.nativeOutcome === "uncertain" || result.nativeOutcome === "accepted");

/** A delayed reply cannot outrank proof of acceptance, refusal, or commit. */
function deliveryStage(result: SessionOperationObservation): number {
  if (result.handoff?.committed) return 5;
  if (!isUnresolved(result)) return 4;
  if (result.nativeOutcome === "accepted") return result.pending ? 2 : 3;
  return result.pending ? 0 : 1;
}

export function readHandoffDelivery(
  observed: SessionOperationObservation | undefined,
  state: HandoffDeliveryState,
  hostEpoch: string | null,
): HandoffDeliverySnapshot {
  const reply = handoffReplyForHost(state, hostEpoch);
  const latest = latestHandoff(observed, state, reply?.response);
  const waitingForLocalDraft = state.attempt !== undefined;
  const blocked = waitingForLocalDraft || (latest !== undefined && isUnresolved(latest));
  const pending = latest?.pending || (waitingForLocalDraft && !latest && !reply?.error);
  return { latest, reply, waitingForLocalDraft, blocked, pending };
}

export function observeHandoffCommit(
  sessions: Pick<
    AgentSessionsStore,
    "subscribe" | "getHandoffBaseline" | "getHandoffHostEpoch" | "getHandoffOperation"
  >,
  source: AgentSessionIdentity,
  local: {
    read: () => HandoffDeliveryState;
    subscribe: (listener: () => void) => () => void;
  },
  onCommit: (link: HandoffLink) => void,
): () => void {
  const readLatest = (state: HandoffDeliveryState) =>
    readHandoffDelivery(sessions.getHandoffOperation(source), state, sessions.getHandoffHostEpoch())
      .latest;
  const initial = readLatest(local.read());
  let handledSubmissionId = initial?.handoff?.committed ? initial.submissionId : undefined;
  let previous = initial;
  let previousBaseline = sessions.getHandoffBaseline();
  const receive = () => {
    const state = local.read();
    const current = readLatest(state);
    const baseline = sessions.getHandoffBaseline();
    const matchingAttempt = !!current?.submissionId && state.attempt?.id === current.submissionId;
    const historicalSnapshot =
      baseline !== previousBaseline &&
      !matchingAttempt &&
      (previous?.submissionId !== current?.submissionId || previous?.handoff?.committed);
    previous = current;
    previousBaseline = baseline;
    const link = current?.handoff?.acceptedLink;
    if (
      !link ||
      !current.handoff?.committed ||
      !current.submissionId ||
      handledSubmissionId === current.submissionId ||
      !matchesAgentSessionIdentity(link.from, source)
    )
      return;
    handledSubmissionId = current.submissionId;
    if (!historicalSnapshot) onCommit(link);
  };
  const stopLocal = local.subscribe(receive);
  const stopLive = sessions.subscribe(receive);
  receive();
  return () => {
    stopLocal();
    stopLive();
  };
}

function beginLocalHandoff(
  sessions: Pick<AgentSessionsStore, "subscribe" | "getHandoffHostEpoch">,
  hostEpoch: string,
  read: () => SessionOperationObservation | undefined,
  recover: (id: string) => void,
  release: () => void,
  sendFinished: Promise<void>,
): LocalHandoff {
  const id = crypto.randomUUID();
  const { promise: settled, resolve } = Promise.withResolvers<boolean>();
  const settleUnsent = () => {
    stop();
    release();
    resolve(false);
  };
  const settleFrom = (next: SessionOperationObservation | undefined) => {
    if (next?.submissionId !== id || next.pending) return;
    if (next.handoff?.committed) {
      stop();
      resolve(true);
    } else if (next.nativeOutcome === "refused" || next.nativeOutcome === "not_issued") {
      settleUnsent();
    }
  };
  const attempt = {
    id,
    kind: "handoff_pending" as const,
    settled,
    settleFrom,
    settleUnsent,
    hostEpoch,
    sendFinished,
  };
  let previousEpoch = attempt.hostEpoch;
  const stop = sessions.subscribe(() => {
    const epoch = sessions.getHandoffHostEpoch();
    const observed = read();
    const replaced = replacedHost(previousEpoch, epoch);
    previousEpoch = epoch ?? previousEpoch;
    if (replaced && observed?.submissionId !== id) {
      recover(id);
      return;
    }
    settleFrom(observed);
  });
  return attempt;
}

/** Keeps a submitted draft tied to the native receipt, even if the composer unmounts. */
export function createHandoffDelivery({
  client,
  sessions,
  chat,
  identity,
  read,
  set,
}: {
  client: Pick<HostClient, "agentChatHandoffSend" | "agentChatHandoffCheck">;
  sessions: Pick<AgentSessionsStore, "subscribe" | "getHandoffHostEpoch" | "getHandoffOperation">;
  chat: AgentChatRef | null;
  identity: AgentSessionIdentity | null;
  read: () => HandoffDeliveryState;
  set: (changes: Partial<HandoffDeliveryState>) => void;
}): HandoffDeliveryCommands {
  const readObservation = () => (identity ? sessions.getHandoffOperation(identity) : undefined);
  const readDelivery = () =>
    readHandoffDelivery(readObservation(), read(), sessions.getHandoffHostEpoch());

  const update = (response: AgentChatHandoffResult) => {
    const attempt = read().attempt;
    if (attempt && response.submissionId !== attempt.id) return;
    set({
      reply: { hostEpoch: sessions.getHandoffHostEpoch(), response },
      hideSettled: false,
    });
    attempt?.settleFrom(response);
  };
  const recordError = (cause: unknown, submissionId: string) => {
    const failure = cause instanceof HostInvokeError ? cause.failure : null;
    const observation = failure?.kind === "session_operation" ? failure.observation : undefined;
    const state = read();
    const { attempt } = state;
    const epoch = sessions.getHandoffHostEpoch();
    const error = cause instanceof Error ? cause.message : String(cause);
    if (!observation || observation.submissionId !== (attempt?.id ?? submissionId)) {
      set({
        reply: {
          hostEpoch: epoch,
          response: handoffReplyForHost(state, epoch)?.response,
          error,
        },
      });
      return;
    }
    const missingAfterReplacement =
      attempt !== undefined &&
      observation.failure?.code === HANDOFF_ATTEMPT_MISSING &&
      replacedHost(attempt.hostEpoch, epoch);
    let response = observation;
    if (missingAfterReplacement) {
      response = {
        ...observation,
        nativeOutcome: "not_issued",
        failure: {
          stage: "check",
          code: HANDOFF_ATTEMPT_MISSING,
          message: "The replacement host has no saved link for this handoff.",
          nextAction: "Review the saved session before starting a new handoff.",
        },
      };
    }
    set({
      reply: { hostEpoch: epoch, response, error: missingAfterReplacement ? undefined : error },
    });
    attempt?.settleFrom(response);
  };
  const check = async (requestedId?: string) => {
    const attempt = read().attempt;
    const submissionId = requestedId ?? attempt?.id ?? readDelivery().latest?.submissionId;
    if (!chat || !submissionId) return;
    if (attempt && replacedHost(attempt.hostEpoch, sessions.getHandoffHostEpoch())) {
      await attempt.sendFinished;
      if (read().attempt !== attempt) return;
    }
    const epoch = sessions.getHandoffHostEpoch();
    if (epoch === null) return;
    try {
      const response = await client.agentChatHandoffCheck(
        { chat, submissionId },
        {
          expectedHostEpoch: epoch,
        },
      );
      if (!replacedHost(epoch, sessions.getHandoffHostEpoch())) update(response);
    } catch (cause) {
      if (!replacedHost(epoch, sessions.getHandoffHostEpoch())) recordError(cause, submissionId);
    }
  };
  const send: HandoffDeliveryCommands["send"] = async (destination, parts) => {
    if (!chat || !identity || readDelivery().blocked) return false;
    const epoch = sessions.getHandoffHostEpoch();
    if (epoch === null) {
      set({
        reply: {
          hostEpoch: epoch,
          error: "The host connection is still opening. Wait for it to connect, then retry.",
        },
      });
      return false;
    }
    const { promise: sendFinished, resolve: finishSend } = Promise.withResolvers<void>();
    const attempt = beginLocalHandoff(
      sessions,
      epoch,
      readObservation,
      (submissionId) => {
        set({ reply: undefined });
        void check(submissionId);
      },
      () => set({ attempt: undefined }),
      sendFinished,
    );
    set({ hideSettled: false, reply: undefined, attempt });
    try {
      const response = await client.agentChatHandoffSend(
        {
          chat,
          expectedActive: identity,
          destination,
          submissionId: attempt.id,
          parts,
        },
        { expectedHostEpoch: epoch },
      );
      if (replacedHost(epoch, sessions.getHandoffHostEpoch())) return attempt;
      update(response);
      if (response.handoff.committed) return true;
      if (
        !response.pending &&
        (response.nativeOutcome === "refused" || response.nativeOutcome === "not_issued")
      )
        return false;
    } catch (cause) {
      if (isHostInvocationRefused(cause)) {
        recordError(cause, attempt.id);
        attempt.settleUnsent();
        return false;
      }
      if (replacedHost(epoch, sessions.getHandoffHostEpoch())) return attempt;
      recordError(cause, attempt.id);
      if (!read().attempt) return false;
    } finally {
      finishSend();
    }
    return attempt;
  };
  return { send, check: () => check() };
}
