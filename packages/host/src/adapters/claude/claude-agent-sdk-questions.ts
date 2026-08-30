import type { OnUserDialog, UserDialogResult } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import {
  claudePendingInputResolutionRoute,
  claudeSubagentPendingInputRoute,
  emitClaudePendingInputEvent,
} from "./claude-agent-sdk-pending-input-routing";
import {
  isClaudeProtocolObject,
  parseClaudeCanonicalJsonObject,
  type ClaudeProtocolObject,
  type ClaudeProtocolValue,
} from "./claude-agent-sdk-ingress-schemas";
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

const nonEmptyClaudeQuestionTextSchema = z.string().trim().min(1);
const claudeQuestionPreviewSchema = z.string();

const readString = (value: ClaudeProtocolValue | undefined): string | null => {
  const parsed = nonEmptyClaudeQuestionTextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const readOptions = (
  value: ClaudeProtocolValue | undefined,
): ClaudeAskUserQuestionOption[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const options: ClaudeAskUserQuestionOption[] = [];
  for (const option of value) {
    if (!isClaudeProtocolObject(option)) {
      return null;
    }
    const label = readString(option.label);
    const description = readString(option.description);
    if (!label || !description) {
      return null;
    }
    const parsedPreview = claudeQuestionPreviewSchema.safeParse(option.preview);
    const questionOption: ClaudeAskUserQuestionOption = { label, description };
    if (parsedPreview.success && parsedPreview.data.length > 0) {
      questionOption.preview = parsedPreview.data;
    }
    options.push(questionOption);
  }
  return options;
};

const parseClaudeAskUserQuestionInput = (
  toolInput: ClaudeProtocolObject,
): ClaudeAskUserQuestionPayload | null => {
  const rawQuestions = toolInput.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }

  const sdkQuestions: ClaudeAskUserQuestion[] = [];
  const eventQuestions: Question[] = [];
  const questionTexts = new Set<string>();
  for (const rawQuestion of rawQuestions) {
    if (!isClaudeProtocolObject(rawQuestion)) {
      return null;
    }
    const question = readString(rawQuestion.question);
    const header = readString(rawQuestion.header);
    const options = readOptions(rawQuestion.options);
    if (!question || !header || !options || questionTexts.has(question)) {
      return null;
    }
    questionTexts.add(question);
    const multiSelect = Boolean(rawQuestion.multiSelect);
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
}) => {
  const answersByQuestion: Record<string, string> = {};
  payload.sdkQuestions.forEach((question, index) => {
    answersByQuestion[question.question] = answerString(answers[index] ?? []);
  });

  return {
    questions: payload.sdkQuestions,
    answers: answersByQuestion,
  } satisfies {
    questions: ClaudeAskUserQuestion[];
    answers: Record<string, string>;
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
  toolInput: ClaudeProtocolObject;
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
    ...claudeSubagentPendingInputRoute(session, agentID),
  };
  const answers = await new Promise<string[][] | null>((resolve, reject) => {
    let requestPublished = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      session.abortController.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (!session.pendingQuestions.delete(requestId)) {
        return;
      }
      cleanup();
      if (requestPublished) {
        try {
          emitClaudePendingInputEvent({
            emit,
            session,
            event: {
              type: "question_resolved",
              externalSessionId: session.externalSessionId,
              timestamp: now(),
              requestId,
              ...claudePendingInputResolutionRoute(event),
            },
          });
        } catch (error) {
          reject(error);
          return;
        }
      }
      resolve(null);
    };
    if (signal.aborted || session.abortController.signal.aborted) {
      resolve(null);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    session.abortController.signal.addEventListener("abort", onAbort, {
      once: true,
    });
    session.pendingQuestions.set(requestId, {
      event,
      resolve: (nextAnswers) => {
        cleanup();
        resolve(nextAnswers);
      },
    });
    if (signal.aborted || session.abortController.signal.aborted) {
      onAbort();
      return;
    }
    try {
      emitClaudePendingInputEvent({ emit, event, session });
      requestPublished = true;
    } catch (error) {
      session.pendingQuestions.delete(requestId);
      cleanup();
      reject(error);
    }
  });

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
      toolInput: parseClaudeCanonicalJsonObject(request.payload, "claudeUserDialogPayload"),
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
