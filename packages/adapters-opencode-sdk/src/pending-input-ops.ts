import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  ReplyApprovalInput,
  ReplyQuestionInput,
} from "@openducktor/core";
import {
  normalizeOpenCodeApprovalRequest,
  toOpenCodePermissionReply,
} from "./approval-translation";
import { unwrapData } from "./data-utils";
import { asUnknownRecord, readStringProp } from "./guards";
import { toOpenCodeRequestError } from "./request-errors";
import type { ClientFactory, SessionRecord } from "./types";

type OpencodeLiveSessionPendingInputBySessionId = Record<
  string,
  {
    approvals: AgentPendingApprovalRequest[];
    questions: AgentPendingQuestionRequest[];
  }
>;

const normalizeQuestionOptions = (
  value: unknown,
  requestId: string,
  questionIndex: number,
): AgentPendingQuestionRequest["questions"][number]["options"] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, optionIndex) => {
    const record = asUnknownRecord(entry);
    if (!record) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': option ${optionIndex} for question ${questionIndex} must be an object.`,
      );
    }
    const label = readStringProp(record, ["label"]);
    if (!label) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': option ${optionIndex} for question ${questionIndex} is missing label.`,
      );
    }
    const description = readStringProp(record, ["description"]) ?? label;
    return { label, description };
  });
};

const normalizePendingQuestion = (value: unknown): AgentPendingQuestionRequest => {
  const record = asUnknownRecord(value);
  if (!record) {
    throw new Error("Malformed Opencode pending question payload: expected an object.");
  }
  const requestId = readStringProp(record, ["id", "requestID", "requestId"]);
  const sessionId = readStringProp(record, ["sessionID", "sessionId", "session_id"]);
  const rawQuestions = record.questions;
  if (!requestId) {
    throw new Error("Malformed Opencode pending question payload: missing request id.");
  }
  if (!sessionId) {
    throw new Error("Malformed Opencode pending question payload: missing session id.");
  }
  if (!Array.isArray(rawQuestions)) {
    throw new Error(
      `Malformed Opencode pending question payload '${requestId}': missing questions array.`,
    );
  }

  const questions = rawQuestions.map((entry, questionIndex) => {
    const question = asUnknownRecord(entry);
    if (!question) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': question ${questionIndex} must be an object.`,
      );
    }
    const header = readStringProp(question, ["header", "title", "label"]);
    const prompt = readStringProp(question, ["question", "title", "header"]);
    if (!header) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': question ${questionIndex} is missing header.`,
      );
    }
    if (!prompt) {
      throw new Error(
        `Malformed Opencode pending question payload '${requestId}': question ${questionIndex} is missing question text.`,
      );
    }
    const options = normalizeQuestionOptions(question.options, requestId, questionIndex);
    return {
      header,
      question: prompt,
      options,
      ...(typeof question.multiple === "boolean" ? { multiple: question.multiple } : {}),
      ...(typeof question.custom === "boolean" ? { custom: question.custom } : {}),
    };
  });

  if (questions.length === 0) {
    throw new Error(
      `Malformed Opencode pending question payload '${requestId}': missing questions.`,
    );
  }

  return {
    requestId,
    questions,
  };
};

const readPendingSessionId = (value: unknown): string | undefined => {
  return readStringProp(value, ["sessionID", "sessionId", "session_id"]);
};

const requirePendingSessionId = (kind: "approval" | "question", value: unknown): string => {
  const sessionId = readPendingSessionId(value);
  if (!sessionId) {
    throw new Error(`Malformed Opencode pending ${kind} payload: missing session id.`);
  }
  return sessionId;
};

export const listOpencodeLiveSessionPendingInput = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
  },
): Promise<OpencodeLiveSessionPendingInputBySessionId> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
    workingDirectory: input.workingDirectory,
  });
  const [permissionResponse, questionResponse] = await Promise.all([
    client.permission.list({
      directory: input.workingDirectory,
    }),
    client.question.list({
      directory: input.workingDirectory,
    }),
  ]);
  const permissions = unwrapData(permissionResponse, "list pending permissions");
  const questions = unwrapData(questionResponse, "list pending questions");

  const bySession: OpencodeLiveSessionPendingInputBySessionId = {};

  for (const entry of permissions) {
    const sessionId = requirePendingSessionId("approval", entry);
    const normalized = normalizeOpenCodeApprovalRequest(entry);
    bySession[sessionId] ??= { approvals: [], questions: [] };
    bySession[sessionId].approvals.push(normalized);
  }

  for (const entry of questions) {
    const sessionId = requirePendingSessionId("question", entry);
    const normalized = normalizePendingQuestion(entry);
    bySession[sessionId] ??= { approvals: [], questions: [] };
    bySession[sessionId].questions.push(normalized);
  }

  return bySession;
};

export const replyApproval = async (
  session: SessionRecord,
  input: ReplyApprovalInput,
): Promise<void> => {
  const response = await session.client.permission.reply({
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    reply: toOpenCodePermissionReply(input.outcome),
    ...(input.message ? { message: input.message } : {}),
  });
  if (response.error) {
    throw toOpenCodeRequestError("reply to permission request", response.error, response.response);
  }
};

export const replyQuestion = async (
  session: SessionRecord,
  input: ReplyQuestionInput,
): Promise<void> => {
  const response = await session.client.question.reply({
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    answers: input.answers,
  });
  if (response.error) {
    throw toOpenCodeRequestError("reply to question request", response.error, response.response);
  }
};
