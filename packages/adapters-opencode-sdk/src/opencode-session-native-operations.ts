import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { SessionRef } from "@openducktor/core";
import { toOpenCodePermissionReply } from "./approval-translation";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringProp } from "./guards";
import { extractMessageTotalTokens, readMessageModelSelection } from "./message-normalizers";
import type { OpencodeSessionContextUsage } from "./opencode-session-runtime-signals";
import { toOpenCodeRequestError } from "./request-errors";
import type { ClientFactory } from "./types";

export type OpencodeNativeApprovalReply = {
  readonly ref: SessionRef;
  readonly nativeRequestId: string;
  readonly outcome: RuntimeApprovalReplyOutcome;
  readonly message?: string;
};

export type OpencodeNativeQuestionReply = {
  readonly ref: SessionRef;
  readonly nativeRequestId: string;
  readonly answers: string[][];
};

type OpencodeNativeOperationContext = {
  readonly createClient: ClientFactory;
  readonly runtimeEndpoint: string;
};

export const readLatestOpencodeContextUsage = async (
  context: OpencodeNativeOperationContext,
  ref: SessionRef,
): Promise<OpencodeSessionContextUsage | null> => {
  const client = context.createClient({
    runtimeEndpoint: context.runtimeEndpoint,
    workingDirectory: ref.workingDirectory,
  });
  const response = await client.session.messages({
    directory: ref.workingDirectory,
    sessionID: ref.externalSessionId,
    limit: 1,
  });
  const messages = unwrapData(response, "load latest session context usage");
  const latestAssistant = [...messages]
    .reverse()
    .find(
      (message) => readStringProp(asUnknownRecord(message.info) ?? {}, ["role"]) === "assistant",
    );
  if (!latestAssistant) {
    return null;
  }
  const totalTokens = extractMessageTotalTokens(latestAssistant.info, latestAssistant.parts);
  if (typeof totalTokens !== "number") {
    return null;
  }
  const model = readMessageModelSelection(latestAssistant.info);
  return { totalTokens, ...(model ? { model } : {}) };
};

export const replyToOpencodeApproval = async (
  context: OpencodeNativeOperationContext,
  input: OpencodeNativeApprovalReply,
): Promise<void> => {
  const client = context.createClient({
    runtimeEndpoint: context.runtimeEndpoint,
    workingDirectory: input.ref.workingDirectory,
  });
  const response = await client.permission.reply({
    directory: input.ref.workingDirectory,
    requestID: input.nativeRequestId,
    reply: toOpenCodePermissionReply(input.outcome),
    ...(input.message ? { message: input.message } : {}),
  });
  if (response.error) {
    throw toOpenCodeRequestError("reply to permission request", response.error, response.response);
  }
};

export const replyToOpencodeQuestion = async (
  context: OpencodeNativeOperationContext,
  input: OpencodeNativeQuestionReply,
): Promise<void> => {
  const client = context.createClient({
    runtimeEndpoint: context.runtimeEndpoint,
    workingDirectory: input.ref.workingDirectory,
  });
  const response = await client.question.reply({
    directory: input.ref.workingDirectory,
    requestID: input.nativeRequestId,
    answers: input.answers,
  });
  if (response.error) {
    throw toOpenCodeRequestError("reply to question request", response.error, response.response);
  }
};
