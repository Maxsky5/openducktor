import { z } from "zod";
import {
  agentAsyncQuestionMatchesReplyId,
  type AgentAsyncQuestion,
  type AgentAsyncQuestionReply,
  type CodexAppServerThreadItem,
  type CodexAppServerUserInput,
} from "@openducktor/contracts";

const OPEN_TAG = "<send_user_message_question_reply>";
const CLOSE_TAG = "</send_user_message_question_reply>";
const IDE_CONTEXT_PREFIX = "# Context from my IDE setup:\n";
const IDE_REQUEST_DELIMITER = "\n## My request for Codex:\n";
export const CODEX_ASYNC_QUESTION_FALLBACK_ERROR =
  "OpenDucktor could not open this structured question. Answer through the main chat composer.";

type CodexAgentMessageItem = Extract<CodexAppServerThreadItem, { type: "agentMessage" }>;

const sourceQuestionSchema = z.object({
  title: z.string().refine((value) => value.trim().length > 0),
  options: z
    .array(z.string().refine((value) => value.trim().length > 0))
    .min(1)
    .nullable(),
});

const replySchema = z.object({
  questionItemId: z.string().refine((value) => value.trim().length > 0),
  question: z.string().refine((value) => value.trim().length > 0),
  answer: z.string().refine((value) => value.trim().length > 0),
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
  if (item.questions == null) {
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

const unwrapCodexIdeContext = (text: string): string | null => {
  if (!text.startsWith(IDE_CONTEXT_PREFIX)) {
    return text;
  }
  const delimiterIndex = text.lastIndexOf(IDE_REQUEST_DELIMITER);
  if (delimiterIndex < 0) {
    return null;
  }
  return text.slice(delimiterIndex + IDE_REQUEST_DELIMITER.length).trim();
};

export const parseCodexAsyncQuestionReplies = (text: string): AgentAsyncQuestionReply[] | null => {
  const trimmed = unwrapCodexIdeContext(text.trim());
  if (trimmed === null) {
    return null;
  }
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

export const parseCodexAsyncQuestionReplyInputs = (
  inputs: readonly CodexAppServerUserInput[],
): AgentAsyncQuestionReply[] | null => {
  const content = inputs.filter((input) => input.type !== "skill" && input.type !== "mention");
  if (content.length !== 1 || content[0]?.type !== "text") {
    return null;
  }
  return parseCodexAsyncQuestionReplies(content[0].text);
};

export const codexAsyncQuestionReplyText = (replies: AgentAsyncQuestionReply[]): string =>
  replies.map((reply) => `> ${reply.question}\n\n${reply.answer}`).join("\n\n");

type AsyncQuestionSessionState = {
  baselineComplete: boolean;
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
      baselineComplete: false,
      pending: new Map(),
      handled: new Set(),
      seenSourceMessages: new Set(),
    };
    this.sessions.set(key, created);
    return created;
  }

  initializeFreshSession(runtimeId: string, threadId: string): void {
    this.state(runtimeId, threadId).baselineComplete = true;
  }

  add(runtimeId: string, threadId: string, questions: AgentAsyncQuestion[]): void {
    const state = this.state(runtimeId, threadId);
    const sourceMessageId = questions[0]?.sourceMessageId;
    if (!sourceMessageId || state.seenSourceMessages.has(sourceMessageId)) {
      return;
    }
    state.seenSourceMessages.add(sourceMessageId);
    for (const question of questions) {
      if (
        !state.handled.has(question.questionItemId) &&
        !state.handled.has(question.sourceMessageId)
      ) {
        state.pending.set(question.questionItemId, question);
      }
    }
  }

  resolve(runtimeId: string, threadId: string, questionItemIds: readonly string[]): void {
    const state = this.state(runtimeId, threadId);
    for (const replyId of questionItemIds) {
      state.handled.add(replyId);
      for (const [questionItemId, question] of state.pending) {
        if (agentAsyncQuestionMatchesReplyId(question, replyId)) {
          state.pending.delete(questionItemId);
          state.handled.add(questionItemId);
        }
      }
    }
  }

  skipPending(runtimeId: string, threadId: string): void {
    const state = this.state(runtimeId, threadId);
    for (const questionItemId of state.pending.keys()) {
      state.handled.add(questionItemId);
    }
    state.pending.clear();
    state.baselineComplete = true;
  }

  pendingForSession(runtimeId: string, threadId: string): AgentAsyncQuestion[] {
    return [...(this.sessions.get(sessionKey(runtimeId, threadId))?.pending.values() ?? [])];
  }

  isAuthoritative(runtimeId: string, threadId: string): boolean {
    return this.sessions.get(sessionKey(runtimeId, threadId))?.baselineComplete ?? false;
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
