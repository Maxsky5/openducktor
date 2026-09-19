import { z } from "zod";
import type {
  AgentAsyncQuestion,
  AgentAsyncQuestionReply,
  CodexAppServerThreadItem,
} from "@openducktor/contracts";

const OPEN_TAG = "<send_user_message_question_reply>";
const CLOSE_TAG = "</send_user_message_question_reply>";
export const CODEX_ASYNC_QUESTION_FALLBACK_ERROR =
  "OpenDucktor could not open this structured question. Answer through the main chat composer.";

type CodexAgentMessageItem = Extract<CodexAppServerThreadItem, { type: "agentMessage" }>;

const sourceQuestionSchema = z.object({
  title: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).nullable(),
});

const replySchema = z.object({
  questionItemId: z.string().trim().min(1),
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1),
});

export type ParsedCodexAsyncQuestion =
  | { kind: "not_async_question" }
  | { kind: "questions"; questions: AgentAsyncQuestion[] }
  | { kind: "invalid"; error: string };

export const codexAsyncQuestionItemId = (messageId: string, questionIndex: number): string =>
  JSON.stringify(["request_user_input_async", messageId, questionIndex]);

export const parseCodexAsyncQuestionItem = (
  item: CodexAgentMessageItem,
): ParsedCodexAsyncQuestion => {
  if (item.delivery !== "async") {
    return { kind: "not_async_question" };
  }
  const parsed = z.array(sourceQuestionSchema).min(1).safeParse(item.questions);
  if (!parsed.success) {
    return { kind: "invalid", error: CODEX_ASYNC_QUESTION_FALLBACK_ERROR };
  }
  return {
    kind: "questions",
    questions: parsed.data.map((question, questionIndex) => ({
      questionItemId: codexAsyncQuestionItemId(item.id, questionIndex),
      sourceMessageId: item.id,
      questionIndex,
      title: question.title,
      options: question.options,
    })),
  };
};

export const encodeCodexAsyncQuestionReply = (reply: AgentAsyncQuestionReply): string =>
  `${OPEN_TAG}${JSON.stringify(reply)}${CLOSE_TAG}`;

export const parseCodexAsyncQuestionReplies = (text: string): AgentAsyncQuestionReply[] | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(OPEN_TAG) || !trimmed.endsWith(CLOSE_TAG)) {
    return null;
  }
  const json = trimmed.slice(OPEN_TAG.length, -CLOSE_TAG.length);
  try {
    const value: unknown = JSON.parse(json);
    const parsed = (Array.isArray(value) ? z.array(replySchema).min(1) : replySchema).safeParse(
      value,
    );
    if (!parsed.success) {
      return null;
    }
    return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  } catch {
    return null;
  }
};

export const codexAsyncQuestionReplyText = (replies: AgentAsyncQuestionReply[]): string =>
  replies.map((reply) => `> ${reply.question}\n\n${reply.answer}`).join("\n\n");

type AsyncQuestionSessionState = {
  pending: Map<string, AgentAsyncQuestion>;
  handled: Set<string>;
  seenSourceMessages: Set<string>;
};

const sessionKey = (runtimeId: string, threadId: string): string =>
  JSON.stringify([runtimeId, threadId]);

export class CodexAsyncQuestionState {
  private readonly sessions = new Map<string, AsyncQuestionSessionState>();

  private state(runtimeId: string, threadId: string): AsyncQuestionSessionState {
    const key = sessionKey(runtimeId, threadId);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }
    const created: AsyncQuestionSessionState = {
      pending: new Map(),
      handled: new Set(),
      seenSourceMessages: new Set(),
    };
    this.sessions.set(key, created);
    return created;
  }

  add(runtimeId: string, threadId: string, questions: AgentAsyncQuestion[]): void {
    const state = this.state(runtimeId, threadId);
    const sourceMessageId = questions[0]?.sourceMessageId;
    if (!sourceMessageId || state.seenSourceMessages.has(sourceMessageId)) {
      return;
    }
    state.seenSourceMessages.add(sourceMessageId);
    for (const question of questions) {
      if (!state.handled.has(question.questionItemId)) {
        state.pending.set(question.questionItemId, question);
      }
    }
  }

  resolve(runtimeId: string, threadId: string, questionItemIds: readonly string[]): void {
    const state = this.state(runtimeId, threadId);
    for (const questionItemId of questionItemIds) {
      state.pending.delete(questionItemId);
      state.handled.add(questionItemId);
    }
  }

  skipPending(runtimeId: string, threadId: string): void {
    const state = this.state(runtimeId, threadId);
    for (const questionItemId of state.pending.keys()) {
      state.handled.add(questionItemId);
    }
    state.pending.clear();
  }

  pendingForSession(runtimeId: string, threadId: string): AgentAsyncQuestion[] {
    return [...this.state(runtimeId, threadId).pending.values()];
  }

  clearSession(runtimeId: string, threadId: string): void {
    this.sessions.delete(sessionKey(runtimeId, threadId));
  }

  clearRuntime(runtimeId: string): void {
    for (const key of this.sessions.keys()) {
      const parsed: unknown = JSON.parse(key);
      if (Array.isArray(parsed) && parsed[0] === runtimeId) {
        this.sessions.delete(key);
      }
    }
  }
}
