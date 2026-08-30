import { jsonObjectSchema } from "@openducktor/contracts";
import type {
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  ReplyApprovalInput,
  ReplyQuestionInput,
} from "@openducktor/core";
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client";
import { z } from "zod";
import {
  normalizeOpenCodeApprovalRequest,
  toOpenCodePermissionReply,
} from "./approval-translation";
import { unwrapData } from "./data-utils";
import { toOpenCodeRequestError } from "./request-errors";
import type { ClientFactory, SessionRecord } from "./types";

type OpencodeLiveSessionPendingInputBySessionId = Record<
  string,
  {
    approvals: AgentPendingApprovalRequest[];
    questions: AgentPendingQuestionRequest[];
  }
>;

const requiredStringSchema = z.string().min(1, "Expected a non-empty string.");

const opencodePendingApprovalInputSchema = z.object({
  id: requiredStringSchema,
  sessionID: requiredStringSchema,
  permission: requiredStringSchema,
  patterns: z.array(z.string()),
  metadata: jsonObjectSchema,
  always: z.array(z.string()),
  tool: z
    .object({
      messageID: z.string(),
      callID: z.string(),
    })
    .optional(),
});

const opencodePendingQuestionInputSchema = z.object({
  id: requiredStringSchema,
  sessionID: requiredStringSchema,
  questions: z
    .array(
      z.object({
        header: requiredStringSchema,
        question: requiredStringSchema,
        options: z.array(
          z.object({
            label: requiredStringSchema,
            description: requiredStringSchema,
          }),
        ),
        multiple: z.boolean().optional(),
        custom: z.boolean().optional(),
      }),
    )
    .min(1, "Expected at least one question."),
  tool: z
    .object({
      messageID: z.string(),
      callID: z.string(),
    })
    .optional(),
});

type OpenCodePendingApprovalInput = z.infer<typeof opencodePendingApprovalInputSchema>;
type OpenCodePendingQuestionInput = z.infer<typeof opencodePendingQuestionInputSchema>;

const formatPendingInputIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "payload"}: ${issue.message}`)
    .join("; ");

const parsePendingApprovalInput = (value: PermissionRequest): OpenCodePendingApprovalInput => {
  const parsed = opencodePendingApprovalInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Malformed Opencode pending approval payload: ${formatPendingInputIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

const parsePendingQuestionInput = (value: QuestionRequest): OpenCodePendingQuestionInput => {
  const parsed = opencodePendingQuestionInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Malformed Opencode pending question payload: ${formatPendingInputIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

const normalizePendingQuestion = (
  input: OpenCodePendingQuestionInput,
): AgentPendingQuestionRequest => {
  const questions = input.questions.map((question) => {
    const normalizedQuestion: AgentPendingQuestionRequest["questions"][number] = {
      header: question.header,
      question: question.question,
      options: question.options,
    };
    if (question.multiple !== undefined) {
      normalizedQuestion.multiple = question.multiple;
    }
    if (question.custom !== undefined) {
      normalizedQuestion.custom = question.custom;
    }
    return normalizedQuestion;
  });

  return { requestId: input.id, questions };
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
    const approval = parsePendingApprovalInput(entry);
    const normalized = normalizeOpenCodeApprovalRequest({
      requestId: approval.id,
      permission: approval.permission,
      patterns: approval.patterns,
      save: approval.always,
      metadata: approval.metadata,
    });
    const pendingInput = bySession[approval.sessionID] ?? { approvals: [], questions: [] };
    pendingInput.approvals.push(normalized);
    bySession[approval.sessionID] = pendingInput;
  }

  for (const entry of questions) {
    const question = parsePendingQuestionInput(entry);
    const normalized = normalizePendingQuestion(question);
    const pendingInput = bySession[question.sessionID] ?? { approvals: [], questions: [] };
    pendingInput.questions.push(normalized);
    bySession[question.sessionID] = pendingInput;
  }

  return bySession;
};

export const replyApproval = async (
  session: SessionRecord,
  input: ReplyApprovalInput,
): Promise<void> => {
  const request: Parameters<typeof session.client.permission.reply>[0] = {
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    reply: toOpenCodePermissionReply(input.outcome),
  };
  if (input.message) {
    request.message = input.message;
  }
  const response = await session.client.permission.reply(request);
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
