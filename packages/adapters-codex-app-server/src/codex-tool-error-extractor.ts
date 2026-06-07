import { odtToolErrorPayloadSchema } from "@openducktor/contracts";
import {
  arrayFromUnknown,
  extractStringField,
  isPlainObject,
  stringifyJsonValue,
} from "./codex-app-server-shared";

const parseJsonObjectString = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isPlainObject(value) ? value : parseJsonObjectString(value);

const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const errorMessageFromValue = (value: unknown): string | null => {
  return nonEmptyString(value) ?? extractStringField(value, ["message"]);
};

const contentText = (value: unknown): string | null => {
  let content: unknown[] = [];
  if (Array.isArray(value)) {
    content = value;
  } else if (isPlainObject(value)) {
    content = arrayFromUnknown(value.content ?? value.contentItems ?? value.content_items);
  }

  const text = content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (!isPlainObject(entry)) {
        return "";
      }
      return extractStringField(entry, ["text", "inputText", "outputText", "content"]) ?? "";
    })
    .filter((entry) => entry.trim().length > 0)
    .join("\n");

  return text.length > 0 ? text : null;
};

const odtErrorEnvelopeMessage = (value: unknown): string | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const parsedOdtError = odtToolErrorPayloadSchema.safeParse(record);
  if (!parsedOdtError.success) {
    return null;
  }

  const message = parsedOdtError.data.error.message.trim();
  return message.length > 0 ? message : "Tool failed";
};

const looseErrorEnvelopeMessage = (value: unknown): string | null => {
  const record = asRecord(value);
  if (record?.ok !== false) {
    return null;
  }

  return odtErrorEnvelopeMessage(record) ?? errorMessageFromValue(record.error) ?? "Tool failed";
};

const mcpTransportErrorMessage = (value: unknown): string | null => {
  const text = nonEmptyString(value);
  return text && /^MCP error\s+-?\d+:/i.test(text) ? text : null;
};

const mcpContentErrorMessage = (value: unknown): string | null => {
  const text = contentText(value);
  if (!text) {
    return null;
  }
  return odtErrorEnvelopeMessage(text) ?? mcpTransportErrorMessage(text);
};

const dynamicContentErrorMessage = (value: unknown): string | null => {
  const text = contentText(value);
  return text ? looseErrorEnvelopeMessage(text) : null;
};

const objectField = (
  value: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null => {
  for (const key of keys) {
    const candidate = value[key];
    if (isPlainObject(candidate)) {
      return candidate;
    }
  }
  return null;
};

const failureMarkerMessage = (
  record: Record<string, unknown>,
  structuredContent: Record<string, unknown> | null,
): string | null => {
  if (record.isError !== true && record.ok !== false && record.success !== false) {
    return null;
  }

  const structuredError = structuredContent ? errorMessageFromValue(structuredContent.error) : null;
  return (
    extractStringField(record, ["message"]) ??
    structuredError ??
    contentText(record) ??
    stringifyJsonValue(record) ??
    "Tool failed"
  );
};

const failedStatus = (value: unknown): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/-/g, "_");
  return (
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "error" ||
    normalized === "declined"
  );
};

const mcpToolErrorFromValue = (value: unknown): string | null => {
  const record = asRecord(value);
  if (!record) {
    return mcpContentErrorMessage(value) ?? mcpTransportErrorMessage(value);
  }

  const structuredContent = objectField(record, ["structuredContent", "structured_content"]);
  return (
    odtErrorEnvelopeMessage(record) ??
    odtErrorEnvelopeMessage(structuredContent) ??
    mcpContentErrorMessage(record) ??
    mcpTransportErrorMessage(record.error) ??
    failureMarkerMessage(record, structuredContent)
  );
};

const dynamicToolErrorFromValue = (value: unknown): string | null => {
  const record = asRecord(value);
  if (!record) {
    return dynamicContentErrorMessage(value);
  }

  const structuredContent = objectField(record, ["structuredContent", "structured_content"]);
  return (
    looseErrorEnvelopeMessage(record) ??
    looseErrorEnvelopeMessage(structuredContent) ??
    dynamicContentErrorMessage(record) ??
    errorMessageFromValue(record.error) ??
    extractStringField(record, ["stderr"]) ??
    failureMarkerMessage(record, structuredContent)
  );
};

export const codexMcpToolErrorFromResult = (
  result: unknown,
  item?: Record<string, unknown>,
): string | null => {
  return mcpToolErrorFromValue(result) ?? (item ? mcpToolErrorFromValue(item) : null);
};

export const codexDynamicToolDisplayPayload = (item: Record<string, unknown>): unknown =>
  item.contentItems ?? item.content_items ?? item.result;

export const codexDynamicToolErrorFromItem = (item: Record<string, unknown>): string | null => {
  return (
    dynamicToolErrorFromValue(codexDynamicToolDisplayPayload(item)) ??
    dynamicToolErrorFromValue(item.result) ??
    dynamicToolErrorFromValue(item)
  );
};

export const codexFileChangeErrorFromItem = (item: Record<string, unknown>): string | null => {
  const explicitError = errorMessageFromValue(item.error) ?? extractStringField(item, ["stderr"]);
  if (explicitError) {
    return explicitError;
  }

  if (item.isError === true || item.success === false || failedStatus(item.status)) {
    return extractStringField(item, ["message"]) ?? "Tool failed";
  }

  return null;
};
