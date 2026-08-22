import { jsonValueSchema, type JsonValue, hasRuntimeType } from "@openducktor/contracts";
import { z } from "zod";
import { asUnknownRecord, type UnknownRecord } from "../guards";
import type { ParsedOpencodeEvent as Event } from "../opencode-ingress";

type BusyStatus = {
  type: "busy";
};

type IdleStatus = {
  type: "idle";
};

type RetryStatus = {
  type: "retry";
  attempt: number;
  message: string;
  nextEpochMs: number;
};

export type ParsedSessionStatus = BusyStatus | IdleStatus | RetryStatus;

export type ParsedPermissionAsked = {
  requestId: string;
  permission: string;
  patterns: string[];
  save?: string[];
  metadata?: Record<string, JsonValue>;
};

type ParsedQuestionOption = {
  label: string;
  description: string;
};

type ParsedQuestion = {
  header: string;
  question: string;
  options: ParsedQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type ParsedQuestionAsked = {
  requestId: string;
  questions: ParsedQuestion[];
};

export type ParsedSessionControlEvent =
  | { type: "session_status"; status: ParsedSessionStatus }
  | { type: "permission_asked"; request: ParsedPermissionAsked }
  | { type: "question_asked"; request: ParsedQuestionAsked }
  | {
      type: "pending_input_resolved";
      resolvedType: "approval_resolved" | "question_resolved";
      requestId: string;
    };

export const readEventProperties = (event: Event): UnknownRecord | undefined => {
  return event.properties;
};

const jsonRecordSchema = z.record(z.string(), jsonValueSchema);

const questionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});

const questionSchema = z.object({
  header: z.string(),
  question: z.string(),
  options: z.array(questionOptionSchema),
  multiple: z.boolean().optional(),
  custom: z.boolean().optional(),
});

const sessionStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("idle") }),
  z.object({
    type: z.literal("retry"),
    attempt: z.number(),
    message: z.string(),
    action: z
      .object({
        reason: z.string(),
        provider: z.string(),
        title: z.string(),
        message: z.string(),
        label: z.string(),
        link: z.string().optional(),
      })
      .optional(),
    next: z.number(),
  }),
  z.object({ type: z.literal("busy") }),
]);

const permissionV2SourceSchema = z.object({
  type: z.literal("tool"),
  messageID: z.string(),
  callID: z.string(),
});

export const opencodePermissionV2AskedEventSchema = z.object({
  id: z.string(),
  type: z.literal("permission.v2.asked"),
  properties: z.object({
    id: z.string(),
    sessionID: z.string(),
    action: z.string(),
    resources: z.array(z.string()),
    save: z.array(z.string()).optional(),
    metadata: jsonRecordSchema.optional(),
    source: permissionV2SourceSchema.optional(),
  }),
});

export const opencodePermissionAskedEventSchema = z.object({
  id: z.string(),
  type: z.literal("permission.asked"),
  properties: z.object({
    id: z.string(),
    sessionID: z.string(),
    permission: z.string(),
    patterns: z.array(z.string()),
    metadata: jsonRecordSchema,
    always: z.array(z.string()),
    tool: z.object({ messageID: z.string(), callID: z.string() }).optional(),
  }),
});

const createQuestionAskedEventSchema = <Type extends "question.asked" | "question.v2.asked">(
  type: Type,
) =>
  z.object({
    id: z.string(),
    type: z.literal(type),
    properties: z.object({
      id: z.string(),
      sessionID: z.string(),
      questions: z.array(questionSchema),
      tool: z.object({ messageID: z.string(), callID: z.string() }).optional(),
    }),
  });

export const opencodeQuestionV2AskedEventSchema =
  createQuestionAskedEventSchema("question.v2.asked");

export const opencodeQuestionAskedEventSchema = createQuestionAskedEventSchema("question.asked");

const opencodeQuestionAskedControlEventSchema = z.discriminatedUnion("type", [
  opencodeQuestionV2AskedEventSchema,
  opencodeQuestionAskedEventSchema,
]);

export const opencodeSessionStatusEventSchema = z.object({
  id: z.string(),
  type: z.literal("session.status"),
  properties: z.object({
    sessionID: z.string(),
    status: sessionStatusSchema,
  }),
});

const createPermissionRepliedEventSchema = <
  Type extends "permission.replied" | "permission.v2.replied",
>(
  type: Type,
) =>
  z.object({
    id: z.string(),
    type: z.literal(type),
    properties: z.object({
      sessionID: z.string(),
      requestID: z.string(),
      reply: z.enum(["once", "always", "reject"]),
    }),
  });

export const opencodePermissionV2RepliedEventSchema =
  createPermissionRepliedEventSchema("permission.v2.replied");

export const opencodePermissionRepliedEventSchema =
  createPermissionRepliedEventSchema("permission.replied");

const opencodePermissionRepliedControlEventSchema = z.discriminatedUnion("type", [
  opencodePermissionV2RepliedEventSchema,
  opencodePermissionRepliedEventSchema,
]);

const createQuestionRepliedEventSchema = <Type extends "question.replied" | "question.v2.replied">(
  type: Type,
) =>
  z.object({
    id: z.string(),
    type: z.literal(type),
    properties: z.object({
      sessionID: z.string(),
      requestID: z.string(),
      answers: z.array(z.array(z.string())),
    }),
  });

export const opencodeQuestionV2RepliedEventSchema =
  createQuestionRepliedEventSchema("question.v2.replied");

export const opencodeQuestionRepliedEventSchema =
  createQuestionRepliedEventSchema("question.replied");

const createQuestionRejectedEventSchema = <
  Type extends "question.rejected" | "question.v2.rejected",
>(
  type: Type,
) =>
  z.object({
    id: z.string(),
    type: z.literal(type),
    properties: z.object({ sessionID: z.string(), requestID: z.string() }),
  });

export const opencodeQuestionV2RejectedEventSchema =
  createQuestionRejectedEventSchema("question.v2.rejected");

export const opencodeQuestionRejectedEventSchema =
  createQuestionRejectedEventSchema("question.rejected");

const opencodeQuestionResolvedControlEventSchema = z.discriminatedUnion("type", [
  opencodeQuestionV2RepliedEventSchema,
  opencodeQuestionRepliedEventSchema,
  opencodeQuestionV2RejectedEventSchema,
  opencodeQuestionRejectedEventSchema,
]);

const formatControlEventIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "event"}: ${issue.message}`)
    .join("; ");

const parseControlEvent = <Parsed>(event: Event, schema: z.ZodType<Parsed>): Parsed => {
  const parsed = schema.safeParse(event);
  if (!parsed.success) {
    throw new Error(
      `Malformed OpenCode ${event.type} event: ${formatControlEventIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

const toParsedQuestionAsked = (properties: {
  id: string;
  questions: Array<{
    header: string;
    question: string;
    options: ParsedQuestionOption[];
    multiple?: boolean | undefined;
    custom?: boolean | undefined;
  }>;
}): ParsedQuestionAsked => ({
  requestId: properties.id,
  questions: properties.questions.map((question) => ({
    header: question.header,
    question: question.question,
    options: question.options,
    ...(() => {
      if (question.multiple !== undefined) {
        return { multiple: question.multiple };
      }
      return {};
    })(),
    ...(() => {
      if (question.custom !== undefined) {
        return { custom: question.custom };
      }
      return {};
    })(),
  })),
});

export const parseSessionControlEvent = (event: Event): ParsedSessionControlEvent | undefined => {
  switch (event.type) {
    case "session.status": {
      const parsed = parseControlEvent(event, opencodeSessionStatusEventSchema);
      const status = parsed.properties.status;
      if (status.type !== "retry") {
        return { type: "session_status", status };
      }
      return {
        type: "session_status",
        status: {
          type: "retry",
          attempt: status.attempt,
          message: status.message,
          nextEpochMs: status.next,
        },
      };
    }
    case "permission.v2.asked": {
      const parsed = parseControlEvent(event, opencodePermissionV2AskedEventSchema);
      return {
        type: "permission_asked",
        request: {
          requestId: parsed.properties.id,
          permission: parsed.properties.action,
          patterns: parsed.properties.resources,
          ...(() => {
            if (parsed.properties.save) {
              return { save: parsed.properties.save };
            }
            return {};
          })(),
          ...(() => {
            if (parsed.properties.metadata) {
              return { metadata: parsed.properties.metadata };
            }
            return {};
          })(),
        },
      };
    }
    case "permission.asked": {
      const parsed = parseControlEvent(event, opencodePermissionAskedEventSchema);
      return {
        type: "permission_asked",
        request: {
          requestId: parsed.properties.id,
          permission: parsed.properties.permission,
          patterns: parsed.properties.patterns,
          save: parsed.properties.always,
          metadata: parsed.properties.metadata,
        },
      };
    }
    case "question.v2.asked":
    case "question.asked": {
      const parsed = parseControlEvent(event, opencodeQuestionAskedControlEventSchema);
      return { type: "question_asked", request: toParsedQuestionAsked(parsed.properties) };
    }
    case "permission.v2.replied":
    case "permission.replied": {
      const parsed = parseControlEvent(event, opencodePermissionRepliedControlEventSchema);
      return {
        type: "pending_input_resolved",
        resolvedType: "approval_resolved",
        requestId: parsed.properties.requestID,
      };
    }
    case "question.v2.replied":
    case "question.replied":
    case "question.v2.rejected":
    case "question.rejected": {
      const parsed = parseControlEvent(event, opencodeQuestionResolvedControlEventSchema);
      return {
        type: "pending_input_resolved",
        resolvedType: "question_resolved",
        requestId: parsed.properties.requestID,
      };
    }
    default:
      return undefined;
  }
};

export const readSessionErrorMessage = (properties: UnknownRecord): string => {
  const parsed = z
    .object({
      error: z
        .object({
          data: z
            .object({
              message: z.string().trim().min(1).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .safeParse(properties);

  return parsed.success && parsed.data.error?.data?.message
    ? parsed.data.error.data.message
    : "Unknown session error";
};

export const readTodoPayload = (properties: UnknownRecord | undefined): JsonValue | undefined => {
  return properties?.todos;
};

export const readEventInfo = (properties: UnknownRecord | undefined): UnknownRecord | undefined => {
  return asUnknownRecord(properties?.info);
};

export const readEventPart = (properties: UnknownRecord): UnknownRecord | undefined => {
  return asUnknownRecord(properties.part);
};

export const readMessageCompletedAt = (info: UnknownRecord): number | undefined => {
  const time = asUnknownRecord(info.time);
  if (!time || !hasRuntimeType(time.completed, "number")) {
    return undefined;
  }
  return time.completed;
};
