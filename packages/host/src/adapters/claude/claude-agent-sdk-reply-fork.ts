import { isDeepStrictEqual } from "node:util";
import { deleteSession, forkSession, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSessionForkPoint } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage, SessionRef } from "@openducktor/core";
import { HostOperationError, HostValidationError, errorMessage } from "../../effect/host-errors";
import { isNestedHistoryEntry } from "./claude-agent-sdk-history-entry";
import { parseClaudeHistoryAssistantEntry } from "./claude-agent-sdk-ingress-schemas";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-messages";
import { isClaudeHumanUserMessage } from "./claude-agent-sdk-user-messages";
import { historyMessageText, readStringProp } from "./claude-agent-sdk-utils";

type ClaudeReplyForkInput = {
  source: SessionRef;
  forkPoint: AgentSessionForkPoint;
  history: readonly AgentSessionHistoryMessage[];
  messages: readonly ClaudeHistoryMessage[];
  completedReplyChainIds?: ReadonlyMap<string, string> | undefined;
};

export const forkClaudeReplySession = async (input: ClaudeReplyForkInput): Promise<string> => {
  const { source, forkPoint } = input;
  const chainUuid = findReplyUuid(input);
  const messages = await getSessionMessages(source.externalSessionId, {
    dir: source.workingDirectory,
  });
  const boundaryIndex = messages.findIndex((message) => message.uuid === chainUuid);
  if (boundaryIndex < 0 || messages[boundaryIndex]?.type !== "assistant") {
    throw new HostValidationError({
      field: "forkPoint",
      message: `Claude cannot resolve reply '${forkPoint.messageId}' in its saved conversation chain. Reload the conversation and select another completed reply.`,
    });
  }
  const result = await forkSession(source.externalSessionId, {
    dir: source.workingDirectory,
    upToMessageId: chainUuid,
  });
  if (result.sessionId === source.externalSessionId) {
    throw new HostOperationError({
      operation: "claudeRuntime.forkSession",
      message:
        "Claude returned the source session as its fork. Update Claude Code before retrying.",
    });
  }
  try {
    const child = await getSessionMessages(result.sessionId, { dir: source.workingDirectory });
    const prefix = messages.slice(0, boundaryIndex + 1);
    if (
      child.length !== prefix.length ||
      child.some(
        (message, index) =>
          message.type !== prefix[index]?.type ||
          !isDeepStrictEqual(message.message, prefix[index]?.message),
      )
    ) {
      throw new HostOperationError({
        operation: "claudeRuntime.forkSession",
        message:
          "Claude returned a fork with a different conversation boundary. Reload the source conversation before retrying.",
      });
    }
  } catch (cause) {
    await discardClaudeReplyFork(result.sessionId, source.workingDirectory, cause);
    throw cause;
  }
  return result.sessionId;
};

export const discardClaudeReplyFork = async (
  externalSessionId: string,
  workingDirectory: string,
  cause: unknown,
): Promise<void> => {
  try {
    await deleteSession(externalSessionId, { dir: workingDirectory });
  } catch (cleanup) {
    throw new HostOperationError({
      operation: "claudeRuntime.forkSession",
      message: `${errorMessage(cause)} Could not remove Claude fork '${externalSessionId}': ${errorMessage(cleanup)}. Remove that unused native session before retrying.`,
      cause: new AggregateError([cause, cleanup], "Claude fork and cleanup failed."),
    });
  }
};

const findReplyUuid = (input: ClaudeReplyForkInput): string => {
  const { forkPoint } = input;
  let chainUuid = input.completedReplyChainIds?.get(forkPoint.messageId);
  let previousAssistantUuid: string | undefined;
  for (const entry of input.messages) {
    if (isNestedHistoryEntry(entry)) continue;
    if (entry.type === "user" && isClaudeHumanUserMessage(entry)) previousAssistantUuid = undefined;
    if (entry.type === "assistant") {
      previousAssistantUuid = entry.uuid;
      if (
        (readStringProp(parseClaudeHistoryAssistantEntry(entry).message, "id") ?? entry.uuid) ===
        forkPoint.messageId
      ) {
        chainUuid = entry.uuid;
      }
    } else if (entry.type === "result" && entry.uuid === forkPoint.messageId) {
      chainUuid = previousAssistantUuid;
    }
  }
  const nativeEntry = input.messages.find(
    (entry) => entry.type === "assistant" && entry.uuid === chainUuid,
  );
  const nativeMessage =
    nativeEntry?.type === "assistant"
      ? parseClaudeHistoryAssistantEntry(nativeEntry).message
      : undefined;
  const normalizedId = readStringProp(nativeMessage, "id") ?? nativeEntry?.uuid;
  const completedReply = input.history.find(
    (message) =>
      message.role === "assistant" &&
      message.forkPoint &&
      (message.messageId === forkPoint.messageId || message.messageId === normalizedId),
  );
  if (
    !chainUuid ||
    !completedReply ||
    !nativeMessage ||
    completedReply.text.trim() !== historyMessageText(nativeMessage).trim()
  ) {
    throw new HostValidationError({
      field: "forkPoint",
      message: `Claude reply '${forkPoint.messageId}' has no completed persisted fork point. Reload the conversation and select a completed reply.`,
    });
  }
  return chainUuid;
};
