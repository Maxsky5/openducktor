import type { ClaudeSession } from "./claude-agent-sdk-types";

export const hasActiveSdkUserTurn = (session: ClaudeSession): boolean =>
  session.activeSdkUserTurnCount > 0;

export const canFlushQueuedClaudeUserMessage = (session: ClaudeSession): boolean =>
  session.activity !== "stopped" &&
  session.queuedSdkMessages.length > 0 &&
  !hasActiveSdkUserTurn(session) &&
  session.sdkState !== "running";

export const canPushSdkUserMessageNow = (session: ClaudeSession): boolean =>
  !hasActiveSdkUserTurn(session) &&
  session.queuedSdkMessages.length === 0 &&
  session.sdkState !== "running" &&
  session.modelAfterQueuedTurns === undefined;

export const canRestoreClaudeSessionModelAfterQueuedTurns = (session: ClaudeSession): boolean =>
  session.modelAfterQueuedTurns !== undefined &&
  !hasActiveSdkUserTurn(session) &&
  session.queuedSdkMessages.length === 0 &&
  session.sdkState === "idle";
