import type { RuntimeApprovalRequestType } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { extractStringField, isPlainObject } from "./codex-app-server-shared";
import type { CodexNotificationRecord, CodexServerRequestRecord } from "./types";

export const parseServerRequestRecord = (value: unknown): CodexServerRequestRecord => {
  if (!isPlainObject(value)) {
    throw new Error("Codex app-server server request must be an object.");
  }

  const { id, method, params } = value;
  if (id !== undefined && typeof id !== "number") {
    throw new Error("Codex app-server server request id must be numeric when present.");
  }
  if (typeof method !== "string" || method.trim().length === 0) {
    throw new Error("Codex app-server server request is missing method.");
  }

  return {
    ...(id !== undefined ? { id } : {}),
    method: method.trim(),
    ...(params !== undefined ? { params } : {}),
  };
};

export const READ_ONLY_ROLES = new Set<AgentRole>(["spec", "planner", "qa"]);

export const isMutatingCodexRequest = (request: CodexServerRequestRecord): boolean => {
  const haystack = `${request.method} ${JSON.stringify(request.params ?? {})}`.toLowerCase();
  return [
    "exec",
    "shell",
    "command",
    "write",
    "edit",
    "patch",
    "apply",
    "file",
    "network",
    "permission",
    "approval",
  ].some((needle) => haystack.includes(needle));
};

export const classifyApprovalRequestType = (
  request: CodexServerRequestRecord,
): RuntimeApprovalRequestType => {
  const haystack = `${request.method} ${JSON.stringify(request.params ?? {})}`.toLowerCase();
  if (haystack.includes("command") || haystack.includes("exec") || haystack.includes("shell")) {
    return "command_execution";
  }
  if (haystack.includes("file") || haystack.includes("patch") || haystack.includes("write")) {
    return "file_change";
  }
  if (haystack.includes("permission") || haystack.includes("approval")) {
    return "permission_grant";
  }
  return "runtime_tool";
};

export const toApprovalRequest = (
  request: CodexServerRequestRecord,
  role: AgentRole,
): import("@openducktor/core").AgentPendingApprovalRequest => ({
  requestId: String(request.id),
  requestType: classifyApprovalRequestType(request),
  title: `Codex ${request.method}`,
  summary: `Codex requested ${request.method}.`,
  details: JSON.stringify(request.params ?? {}, null, 2),
  mutation: isMutatingCodexRequest(request) ? "mutating" : "unknown",
  supportedReplyOutcomes: ["approve_once", "reject"],
  metadata: {
    codexMethod: request.method,
    role,
    params: request.params,
  },
});

export const extractTurnId = (value: unknown): string | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  const direct = extractStringField(value, ["turnId", "expectedTurnId"]);
  if (direct) {
    return direct;
  }
  const turn = value.turn;
  return extractStringField(turn, ["id", "turnId"]);
};

export const extractThreadIdFromParams = (value: unknown): string | null => {
  return extractStringField(value, ["threadId", "thread_id"]);
};

export const codexTurnKey = (threadId: string, turnId: string): string => `${threadId}:${turnId}`;

export const isTerminalTurnStatus = (value: unknown): boolean => {
  if (!isPlainObject(value)) {
    return false;
  }
  const status = extractStringField(value, ["status"]);
  return status === "completed" || status === "failed" || status === "interrupted";
};

export const parseQuestionRequest = (
  request: CodexServerRequestRecord,
): {
  request: import("@openducktor/core").AgentPendingQuestionRequest;
  threadId: string;
  turnId: string;
  questionIds: string[];
} => {
  if (request.id === undefined) {
    throw new Error("Codex app-server question request is missing a numeric id.");
  }
  if (!isPlainObject(request.params)) {
    throw new Error("Codex app-server question request params must be an object.");
  }

  const threadId = extractStringField(request.params, ["threadId"]);
  const turnId = extractStringField(request.params, ["turnId"]);
  if (!threadId) {
    throw new Error("Codex app-server question request is missing threadId.");
  }
  if (!turnId) {
    throw new Error("Codex app-server question request is missing turnId.");
  }

  const rawQuestions = request.params.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error("Codex app-server question request must include questions.");
  }

  const questionIds: string[] = [];
  const questions = rawQuestions.map((rawQuestion) => {
    if (!isPlainObject(rawQuestion)) {
      throw new Error("Codex app-server question entries must be objects.");
    }
    const id = extractStringField(rawQuestion, ["id", "questionId"]);
    if (!id) {
      throw new Error("Codex app-server question entry is missing id.");
    }
    questionIds.push(id);
    const options = Array.isArray(rawQuestion.options)
      ? rawQuestion.options.map((rawOption) => {
          if (typeof rawOption === "string") {
            return { label: rawOption, description: "" };
          }
          if (!isPlainObject(rawOption)) {
            throw new Error("Codex app-server question option entries must be strings or objects.");
          }
          const label = extractStringField(rawOption, ["label", "value", "text"]);
          if (!label) {
            throw new Error("Codex app-server question option entry is missing label.");
          }
          return {
            label,
            description: extractStringField(rawOption, ["description", "detail"]) ?? "",
          };
        })
      : [];
    const header = extractStringField(rawQuestion, ["header", "title"]);
    const question = extractStringField(rawQuestion, ["question", "text", "prompt"]);
    if (!header) {
      throw new Error(`Codex app-server question '${id}' is missing header.`);
    }
    if (!question) {
      throw new Error(`Codex app-server question '${id}' is missing question text.`);
    }
    return {
      header,
      question,
      options,
      ...(rawQuestion.multiple === true || rawQuestion.multi === true ? { multiple: true } : {}),
      ...(rawQuestion.isOther === true || rawQuestion.custom === true ? { custom: true } : {}),
    };
  });

  return {
    request: {
      requestId: String(request.id),
      questions,
    },
    threadId,
    turnId,
    questionIds,
  };
};

export const parseNotificationRecord = (value: unknown): CodexNotificationRecord => {
  if (!isPlainObject(value)) {
    throw new Error("Codex app-server notification must be an object.");
  }
  const { method, params } = value;
  if (typeof method !== "string" || method.trim().length === 0) {
    throw new Error("Codex app-server notification is missing method.");
  }
  return { method: method.trim(), ...(params !== undefined ? { params } : {}) };
};
