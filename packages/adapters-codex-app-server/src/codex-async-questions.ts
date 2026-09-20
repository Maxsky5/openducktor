import { z } from "zod";
import type { CodexAppServerThreadItem, CodexAppServerUserInput } from "@openducktor/contracts";
import type { AgentPendingQuestionRequest, AgentSessionHistoryMessage } from "@openducktor/core";

const OPEN_TAG = "<send_user_message_question_reply>";
const CLOSE_TAG = "</send_user_message_question_reply>";
const SKIP_MARKER_PREFIX = "openducktor.async-question-skips:";
export const CODEX_ASYNC_QUESTION_SKIP_CARRIER = "\u2063";
const IDE_CONTEXT_PREFIX = "# Context from my IDE setup:\n";
const IDE_REQUEST_DELIMITER = "\n## My request for Codex:\n";
const CODEX_ASYNC_QUESTION_FALLBACK_ERROR =
  "OpenDucktor could not open this structured question. Answer through the main chat composer.";

type CodexAgentMessageItem = Extract<CodexAppServerThreadItem, { type: "agentMessage" }>;

export type CodexAsyncQuestionReply = {
  questionItemId: string;
  question: string;
  answer: string;
};

const sourceQuestionSchema = z.object({
  title: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(1).nullable(),
});

const replySchema = z.object({
  questionItemId: z.string().trim().min(1),
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1),
});

const skipIdsSchema = z.array(z.string().trim().min(1));
const questionItemIdSchema = z.tuple([
  z.literal("request_user_input_async"),
  z.string().trim().min(1),
  z.number().int().nonnegative(),
]);

export type ParsedCodexAsyncQuestion =
  | { kind: "not_async_question" }
  | { kind: "question"; request: AgentPendingQuestionRequest }
  | { kind: "invalid"; error: string };

export const codexAsyncQuestionItemId = (requestId: string, questionIndex: number): string =>
  JSON.stringify(["request_user_input_async", requestId, questionIndex]);

export const codexAsyncQuestionRequestId = (questionItemId: string): string | null => {
  try {
    return questionItemIdSchema.parse(JSON.parse(questionItemId))[1];
  } catch {
    return null;
  }
};

export const parseCodexAsyncQuestionItem = (
  item: CodexAgentMessageItem,
): ParsedCodexAsyncQuestion => {
  if (item.delivery !== "async" || item.questions == null) {
    return { kind: "not_async_question" };
  }
  const parsed = z.array(sourceQuestionSchema).min(1).safeParse(item.questions);
  if (!parsed.success) {
    return { kind: "invalid", error: CODEX_ASYNC_QUESTION_FALLBACK_ERROR };
  }
  return {
    kind: "question",
    request: {
      requestId: item.id,
      blocking: false,
      questions: parsed.data.map((question) => ({
        header: "",
        question: question.title,
        options: (question.options ?? []).map((label) => ({ label, description: "" })),
      })),
    },
  };
};

export const encodeCodexAsyncQuestionReplies = (
  replies: readonly CodexAsyncQuestionReply[],
): string => {
  if (replies.length === 0) {
    throw new Error("Codex async question replies cannot be empty.");
  }
  return `${OPEN_TAG}${JSON.stringify(replies.length === 1 ? replies[0] : replies)}${CLOSE_TAG}`;
};

export const encodeCodexAsyncQuestionSkips = (requestIds: readonly string[]): string =>
  `${SKIP_MARKER_PREFIX}${JSON.stringify(requestIds)}`;

export const parseCodexAsyncQuestionSkipIds = (
  inputs: readonly CodexAppServerUserInput[],
): string[] | undefined => {
  let marker: string | undefined;
  for (const input of inputs) {
    if (input.type !== "text") continue;
    for (const element of input.text_elements) {
      if (!element.placeholder?.startsWith(SKIP_MARKER_PREFIX)) continue;
      if (marker !== undefined) {
        throw new Error("Codex user message has more than one async question skip marker.");
      }
      marker = element.placeholder;
    }
  }
  if (marker === undefined) return undefined;

  try {
    return skipIdsSchema.parse(JSON.parse(marker.slice(SKIP_MARKER_PREFIX.length)));
  } catch {
    throw new Error("Codex user message has an invalid async question skip marker.");
  }
};

export const stripCodexAsyncQuestionSkipMarker = (
  inputs: readonly CodexAppServerUserInput[],
): CodexAppServerUserInput[] =>
  inputs.flatMap((input): CodexAppServerUserInput[] => {
    if (input.type !== "text") return [input];
    const text_elements = input.text_elements.filter(
      (element) => !element.placeholder?.startsWith(SKIP_MARKER_PREFIX),
    );
    if (
      input.text === CODEX_ASYNC_QUESTION_SKIP_CARRIER &&
      text_elements.length !== input.text_elements.length
    ) {
      return [];
    }
    return [{ ...input, text_elements }];
  });

const unwrapCodexIdeContext = (text: string): string | null => {
  if (!text.startsWith(IDE_CONTEXT_PREFIX)) return text;
  const delimiterIndex = text.lastIndexOf(IDE_REQUEST_DELIMITER);
  if (delimiterIndex < 0) return null;
  return text.slice(delimiterIndex + IDE_REQUEST_DELIMITER.length).trim();
};

export const parseCodexAsyncQuestionReplies = (text: string): CodexAsyncQuestionReply[] | null => {
  const trimmed = unwrapCodexIdeContext(text.trim());
  if (trimmed === null || !trimmed.startsWith(OPEN_TAG) || !trimmed.endsWith(CLOSE_TAG)) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(trimmed.slice(OPEN_TAG.length, -CLOSE_TAG.length));
    const parsed = (Array.isArray(value) ? z.array(replySchema).min(1) : replySchema).safeParse(
      value,
    );
    if (!parsed.success) return null;
    return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  } catch {
    return null;
  }
};

export const parseCodexAsyncQuestionReplyInputs = (
  inputs: readonly CodexAppServerUserInput[],
): CodexAsyncQuestionReply[] | null => {
  const replyInputs = inputs.filter((input) => input.type !== "skill" && input.type !== "mention");
  if (replyInputs.length !== 1 || replyInputs[0]?.type !== "text") return null;
  return parseCodexAsyncQuestionReplies(replyInputs[0].text);
};

export const codexAsyncQuestionReplyText = (replies: readonly CodexAsyncQuestionReply[]): string =>
  replies.map((reply) => `> ${reply.question}\n\n${reply.answer}`).join("\n\n");

type BackgroundQuestionState = {
  pending: Map<string, AgentPendingQuestionRequest>;
  handled: Set<string>;
  replyClaims: Set<string>;
};

const sessionKey = (runtimeId: string, threadId: string): string =>
  JSON.stringify([runtimeId, threadId]);

export class CodexAsyncQuestionState {
  private readonly sessions = new Map<string, BackgroundQuestionState>();

  private state(runtimeId: string, threadId: string): BackgroundQuestionState {
    const key = sessionKey(runtimeId, threadId);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const created: BackgroundQuestionState = {
      pending: new Map(),
      handled: new Set(),
      replyClaims: new Set(),
    };
    this.sessions.set(key, created);
    return created;
  }

  add(runtimeId: string, threadId: string, request: AgentPendingQuestionRequest): void {
    const state = this.state(runtimeId, threadId);
    if (!state.handled.has(request.requestId)) state.pending.set(request.requestId, request);
  }

  resolve(runtimeId: string, threadId: string, requestIds: readonly string[]): void {
    const state = this.state(runtimeId, threadId);
    for (const requestId of requestIds) {
      state.handled.add(requestId);
      state.pending.delete(requestId);
      state.replyClaims.delete(requestId);
    }
  }

  pendingForSession(runtimeId: string, threadId: string): AgentPendingQuestionRequest[] {
    return [...(this.sessions.get(sessionKey(runtimeId, threadId))?.pending.values() ?? [])];
  }

  loadHistory(
    runtimeId: string,
    threadId: string,
    messages: readonly AgentSessionHistoryMessage[],
  ): void {
    const pending = new Map<string, AgentPendingQuestionRequest>();
    const handled = new Set<string>();
    for (const message of messages) {
      if (message.role === "assistant" && message.questionRequest?.blocking === false) {
        const request = message.questionRequest;
        if (!handled.has(request.requestId)) pending.set(request.requestId, request);
        continue;
      }
      if (message.role !== "user") continue;
      const requestIds = message.resolvedQuestionRequestIds ?? [...pending.keys()];
      for (const requestId of requestIds) {
        handled.add(requestId);
        pending.delete(requestId);
      }
    }
    this.resolve(runtimeId, threadId, [...handled]);
    for (const request of pending.values()) this.add(runtimeId, threadId, request);
  }

  claimRepliesForSession(
    runtimeId: string,
    threadId: string,
    requestId: string,
    answers: readonly string[][],
  ): CodexAsyncQuestionReply[] | null {
    const state = this.sessions.get(sessionKey(runtimeId, threadId));
    if (!state) return null;
    const request = state.pending.get(requestId);
    if (!request) return null;
    if (state.replyClaims.has(requestId)) {
      throw new Error(`Codex background question '${requestId}' already has a reply in flight.`);
    }
    if (answers.length !== request.questions.length) {
      throw new Error(
        `Codex question request '${requestId}' expected ${request.questions.length} answer set(s) but received ${answers.length}.`,
      );
    }
    const replies = request.questions.map((question, index) => {
      const answer = answers[index]?.[0]?.trim() ?? "";
      if (answer.length === 0) throw new Error("Answer each question before you submit.");
      return {
        questionItemId: codexAsyncQuestionItemId(requestId, index),
        question: question.question,
        answer,
      };
    });
    state.replyClaims.add(requestId);
    return replies;
  }

  releaseReplyClaim(runtimeId: string, threadId: string, requestId: string): void {
    this.sessions.get(sessionKey(runtimeId, threadId))?.replyClaims.delete(requestId);
  }

  clearSession(runtimeId: string, threadId: string): void {
    this.sessions.delete(sessionKey(runtimeId, threadId));
  }

  clearRuntime(runtimeId: string): void {
    for (const key of this.sessions.keys()) {
      const parsed: unknown = JSON.parse(key);
      if (Array.isArray(parsed) && parsed[0] === runtimeId) this.sessions.delete(key);
    }
  }
}
