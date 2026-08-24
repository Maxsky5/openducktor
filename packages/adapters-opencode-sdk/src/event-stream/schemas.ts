import type { JsonObject } from "@openducktor/contracts";
import type { ParsedOpencodeEvent as Event } from "../opencode-global-event-ingress";

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
  metadata?: JsonObject;
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
    ...(question.multiple !== undefined ? { multiple: question.multiple } : undefined),
    ...(question.custom !== undefined ? { custom: question.custom } : undefined),
  })),
});

export const parseSessionControlEvent = (event: Event): ParsedSessionControlEvent | undefined => {
  switch (event.type) {
    case "session.status": {
      const status = event.properties.status;
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
      const properties = event.properties;
      return {
        type: "permission_asked",
        request: {
          requestId: properties.id,
          permission: properties.action,
          patterns: properties.resources,
          ...(properties.save ? { save: properties.save } : undefined),
          ...(properties.metadata ? { metadata: properties.metadata } : undefined),
        },
      };
    }
    case "permission.asked": {
      const properties = event.properties;
      return {
        type: "permission_asked",
        request: {
          requestId: properties.id,
          permission: properties.permission,
          patterns: properties.patterns,
          save: properties.always,
          metadata: properties.metadata,
        },
      };
    }
    case "question.v2.asked":
    case "question.asked": {
      return { type: "question_asked", request: toParsedQuestionAsked(event.properties) };
    }
    case "permission.v2.replied":
    case "permission.replied": {
      return {
        type: "pending_input_resolved",
        resolvedType: "approval_resolved",
        requestId: event.properties.requestID,
      };
    }
    case "question.v2.replied":
    case "question.replied":
    case "question.v2.rejected":
    case "question.rejected": {
      return {
        type: "pending_input_resolved",
        resolvedType: "question_resolved",
        requestId: event.properties.requestID,
      };
    }
    default:
      return undefined;
  }
};

type OpencodeSessionError = Extract<Event, { type: "session.error" }>["properties"]["error"];

export const readSessionErrorMessage = (error: OpencodeSessionError): string => {
  if (!error || !("message" in error.data) || typeof error.data.message !== "string") {
    return "Unknown session error";
  }
  const message = error.data.message.trim();
  return message.length > 0 ? message : "Unknown session error";
};
