import type { Event } from "@opencode-ai/sdk/v2/client";
import {
  asUnknownRecord,
  readArrayProp,
  readBooleanProp,
  readNumberProp,
  readRecordProp,
  readStringArrayProp,
  readStringProp,
  readUnknownProp,
  type UnknownRecord,
} from "../guards";

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
  metadata?: UnknownRecord;
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

export const readEventProperties = (event: Event): UnknownRecord | undefined => {
  return asUnknownRecord(event.properties);
};

export const readEventInfo = (properties: unknown): UnknownRecord | undefined => {
  return readRecordProp(properties, "info");
};

export const readEventPart = (properties: unknown): UnknownRecord | undefined => {
  return readRecordProp(properties, "part");
};

export const readMessageCompletedAt = (info: unknown): number | undefined => {
  return readNumberProp(readRecordProp(info, "time"), ["completed"]);
};

const parseQuestionOption = (value: unknown): ParsedQuestionOption | null => {
  const record = asUnknownRecord(value);
  if (!record) {
    return null;
  }
  const label = readStringProp(record, ["label"]);
  const description = readStringProp(record, ["description"]);
  if (!label || !description) {
    return null;
  }
  return { label, description };
};

const parseQuestion = (value: unknown): ParsedQuestion | null => {
  const record = asUnknownRecord(value);
  if (!record) {
    return null;
  }
  const header = readStringProp(record, ["header"]);
  const question = readStringProp(record, ["question"]);
  if (!header || !question) {
    return null;
  }

  const options = (readArrayProp(record, "options") ?? [])
    .map(parseQuestionOption)
    .filter((entry): entry is ParsedQuestionOption => entry !== null);

  const multiple = readBooleanProp(record, ["multiple"]);
  const custom = readBooleanProp(record, ["custom"]);

  return {
    header,
    question,
    options,
    ...(multiple !== undefined ? { multiple } : {}),
    ...(custom !== undefined ? { custom } : {}),
  };
};

export const parseSessionStatus = (properties: unknown): ParsedSessionStatus | undefined => {
  const status = readRecordProp(properties, "status");
  if (!status) {
    return undefined;
  }
  const type = readStringProp(status, ["type"]);
  if (!type) {
    return undefined;
  }
  if (type === "busy" || type === "idle") {
    return { type };
  }
  if (type !== "retry") {
    return undefined;
  }

  return {
    type: "retry",
    attempt: readNumberProp(status, ["attempt"]) ?? 0,
    message: readStringProp(status, ["message"]) ?? "Retrying session",
    nextEpochMs: readNumberProp(status, ["next"]) ?? 0,
  };
};

export const parsePermissionAsked = (properties: unknown): ParsedPermissionAsked | undefined => {
  const requestId = readStringProp(properties, ["id"]);
  const permission = readStringProp(properties, ["permission"]);
  if (!requestId || !permission) {
    return undefined;
  }

  const patterns = readStringArrayProp(properties, "patterns") ?? [];
  const metadata = readRecordProp(properties, "metadata");
  return {
    requestId,
    permission,
    patterns,
    ...(metadata ? { metadata } : {}),
  };
};

export const parseQuestionAsked = (properties: unknown): ParsedQuestionAsked | undefined => {
  const requestId = readStringProp(properties, ["id"]);
  if (!requestId) {
    return undefined;
  }

  const questions = (readArrayProp(properties, "questions") ?? [])
    .map(parseQuestion)
    .filter((entry): entry is ParsedQuestion => entry !== null);
  return {
    requestId,
    questions,
  };
};

export const readSessionErrorMessage = (properties: unknown): string => {
  const message = readStringProp(readRecordProp(readRecordProp(properties, "error"), "data"), [
    "message",
  ]);
  return message ?? "Unknown session error";
};

export const readTodoPayload = (properties: unknown): unknown => {
  return readUnknownProp(properties, "todos");
};
