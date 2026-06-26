import type { SessionRecord } from "./types";

export const isStreamTurnIdle = (session: SessionRecord | undefined): boolean => {
  return session?.streamTurnStatus === "idle";
};

export const markStreamTurnActive = (session: SessionRecord | undefined): void => {
  if (!session) {
    return;
  }
  session.streamTurnStatus = "active";
  session.isAwaitingRuntimeTurnStart = false;
};

export const markStreamTurnIdle = (session: SessionRecord | undefined): void => {
  if (!session) {
    return;
  }
  session.streamTurnStatus = "idle";
  session.isAwaitingRuntimeTurnStart = false;
  session.activeAssistantMessageId = null;
};

export const startUserMessageSend = (session: SessionRecord): void => {
  session.isSendingUserMessage = true;
  session.isAwaitingRuntimeTurnStart = true;
};

export const finishUserMessageSend = (session: SessionRecord): void => {
  session.isSendingUserMessage = false;
};

export const isUserMessageSendInFlight = (session: SessionRecord | undefined): boolean => {
  return session?.isSendingUserMessage === true;
};

export const isUserMessageTurnStartPending = (session: SessionRecord | undefined): boolean => {
  return session?.isSendingUserMessage === true || session?.isAwaitingRuntimeTurnStart === true;
};

export const clearUserMessageTurnStartPending = (session: SessionRecord | undefined): void => {
  if (!session) {
    return;
  }
  session.isAwaitingRuntimeTurnStart = false;
};

export const isLocalSessionBusy = (session: SessionRecord): boolean => {
  return (
    session.isSendingUserMessage ||
    session.isAwaitingRuntimeTurnStart ||
    session.streamTurnStatus === "active"
  );
};
