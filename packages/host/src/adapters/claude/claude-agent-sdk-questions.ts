import type { OnUserDialog, UserDialogResult } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import {
  claudeSubagentPendingInputRoute,
  emitClaudePendingInputEvent,
} from "./claude-agent-sdk-pending-input-routing";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";

const CLAUDE_ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";
export const CLAUDE_ASK_USER_QUESTION_DIALOG_KINDS = [
  "permission_ask_user_question",
  "ask_user_question",
  "askUserQuestion",
  "AskUserQuestion",
  "question",
  "user_question",
] as const;

type QuestionRequiredEvent = Extract<AgentEvent, { type: "question_required" }>;
type Question = QuestionRequiredEvent["questions"][number];

type ClaudeAskUserQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

type ClaudeAskUserQuestion = {
  question: string;
  header: string;
  options: ClaudeAskUserQuestionOption[];
  multiSelect: boolean;
};

export type ClaudeAskUserQuestionPayload = {
  sdkQuestions: ClaudeAskUserQuestion[];
  eventQuestions: Question[];
};

export const isClaudeAskUserQuestionTool = (toolName: string): boolean =>
  toolName.trim().toLowerCase() === CLAUDE_ASK_USER_QUESTION_TOOL_NAME.toLowerCase();

const isClaudeAskUserQuestionDialogKind = (dialogKind: string): boolean =>
  CLAUDE_ASK_USER_QUESTION_DIALOG_KINDS.some(
    (candidate) => candidate.toLowerCase() === dialogKind.trim().toLowerCase(),
  );

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readOptions = (value: unknown): ClaudeAskUserQuestionOption[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const options: ClaudeAskUserQuestionOption[] = [];
  for (const option of value) {
    if (!option || typeof option !== "object") {
      return null;
    }
    const record = option as Record<string, unknown>;
    const label = readString(record.label);
    const description = readString(record.description);
    if (!label || !description) {
      return null;
    }
    const preview = typeof record.preview === "string" ? record.preview : undefined;
    options.push({
      label,
      description,
      ...(preview ? { preview } : {}),
    });
  }
  return options;
};

const parseClaudeAskUserQuestionInput = (
  toolInput: Record<string, unknown>,
): ClaudeAskUserQuestionPayload | null => {
  const rawQuestions = toolInput.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }

  const sdkQuestions: ClaudeAskUserQuestion[] = [];
  const eventQuestions: Question[] = [];
  for (const rawQuestion of rawQuestions) {
    if (!rawQuestion || typeof rawQuestion !== "object") {
      return null;
    }
    const record = rawQuestion as Record<string, unknown>;
    const question = readString(record.question);
    const header = readString(record.header);
    const options = readOptions(record.options);
    if (!question || !header || !options) {
      return null;
    }
    const multiSelect = Boolean(record.multiSelect);
    sdkQuestions.push({
      question,
      header,
      options,
      multiSelect,
    });
    eventQuestions.push({
      question,
      header,
      options: options.map(({ label, description }) => ({
        label,
        description,
      })),
      multiple: multiSelect,
      custom: true,
    });
  }

  return { sdkQuestions, eventQuestions };
};

const answerString = (answers: readonly string[]): string =>
  answers
    .map((answer) => answer.trim())
    .filter(Boolean)
    .join(", ");

export const buildClaudeAskUserQuestionResult = ({
  answers,
  payload,
}: {
  answers: readonly string[][];
  payload: ClaudeAskUserQuestionPayload;
}): {
  questions: ClaudeAskUserQuestion[];
  answers: Record<string, string>;
} => {
  const answersByQuestion: Record<string, string> = {};
  payload.sdkQuestions.forEach((question, index) => {
    answersByQuestion[question.question] = answerString(answers[index] ?? []);
  });

  return {
    questions: payload.sdkQuestions,
    answers: answersByQuestion,
  };
};

export const requestClaudeAskUserQuestion = async ({
  emit,
  now,
  randomId,
  session,
  signal,
  toolInput,
  toolUseID,
  agentID,
}: {
  emit: (session: ClaudeSessionContext, event: AgentEvent) => void;
  now: () => string;
  randomId: () => string;
  session: ClaudeSessionContext;
  signal: AbortSignal;
  toolInput: Record<string, unknown>;
  toolUseID?: string | undefined;
  agentID?: string | undefined;
}): Promise<ReturnType<typeof buildClaudeAskUserQuestionResult> | null> => {
  const payload = parseClaudeAskUserQuestionInput(toolInput);
  if (!payload) {
    throw new HostValidationError({
      field: "payload",
      message: "Claude AskUserQuestion dialog payload is invalid.",
      details: { toolUseID },
    });
  }

  const requestId = randomId();
  const event: QuestionRequiredEvent = {
    type: "question_required",
    externalSessionId: session.externalSessionId,
    timestamp: now(),
    requestId,
    questions: payload.eventQuestions,
    ...claudeSubagentPendingInputRoute(session.externalSessionId, agentID),
  };
  const answers = await new Promise<string[][]>((resolve, reject) => {
    const onAbort = () => {
      session.pendingQuestions.delete(requestId);
      reject(new Error("Claude question request was aborted."));
    };
    if (signal.aborted || session.abortController.signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    session.abortController.signal.addEventListener("abort", onAbort, {
      once: true,
    });
    session.pendingQuestions.set(requestId, {
      event,
      resolve: (nextAnswers) => {
        signal.removeEventListener("abort", onAbort);
        session.abortController.signal.removeEventListener("abort", onAbort);
        resolve(nextAnswers);
      },
    });
    if (signal.aborted || session.abortController.signal.aborted) {
      onAbort();
      return;
    }
    emitClaudePendingInputEvent({ emit, event, session });
  }).catch(() => null);

  if (!answers) {
    return null;
  }

  return buildClaudeAskUserQuestionResult({ answers, payload });
};

export const createClaudeUserDialogHandler = ({
  emit,
  now,
  randomId,
  session,
}: {
  emit: (session: ClaudeSessionContext, event: AgentEvent) => void;
  now: () => string;
  randomId: () => string;
  session: ClaudeSessionContext;
}): OnUserDialog => {
  return async (request, options): Promise<UserDialogResult> => {
    if (!isClaudeAskUserQuestionDialogKind(request.dialogKind)) {
      return { behavior: "cancelled" };
    }

    const result = await requestClaudeAskUserQuestion({
      emit,
      now,
      randomId,
      session,
      signal: options.signal,
      toolInput: request.payload,
      toolUseID: request.toolUseID,
    });
    if (!result) {
      return { behavior: "cancelled" };
    }

    return {
      behavior: "completed",
      result,
    };
  };
};
