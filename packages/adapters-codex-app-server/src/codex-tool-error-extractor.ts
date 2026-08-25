import {
  jsonValueSchema,
  odtToolErrorPayloadSchema,
  type CodexAppServerThreadItem,
  type CodexAppServerJsonValue,
} from "@openducktor/contracts";
import {
  arrayFromUnknown,
  extractStringField,
  isPlainObject,
  stringifyJsonValue,
} from "./codex-app-server-shared";

type CodexDynamicToolCallItem = Extract<CodexAppServerThreadItem, { type: "dynamicToolCall" }>;
type CodexFileChangeItem = Extract<CodexAppServerThreadItem, { type: "fileChange" }>;
type CodexMcpToolCallItem = Extract<CodexAppServerThreadItem, { type: "mcpToolCall" }>;
type CodexJsonObject = Record<string, CodexAppServerJsonValue>;

const parseJsonObjectString = (value: CodexAppServerJsonValue | undefined) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(trimmed));
    return parsed.success && isPlainObject(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
};

const asRecord = (value: CodexAppServerJsonValue | undefined): CodexJsonObject | null =>
  isPlainObject(value) ? value : parseJsonObjectString(value);

const nonEmptyString = (value: CodexAppServerJsonValue | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const errorMessageFromValue = (value: CodexAppServerJsonValue | undefined): string | null => {
  return nonEmptyString(value) ?? extractStringField(value, ["message"]);
};

const contentText = (value: CodexAppServerJsonValue | undefined): string | null => {
  let content: CodexAppServerJsonValue[] = [];
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

const odtErrorEnvelopeMessage = (value: CodexAppServerJsonValue | undefined): string | null => {
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

const looseErrorEnvelopeMessage = (value: CodexAppServerJsonValue | undefined): string | null => {
  const record = asRecord(value);
  if (record?.ok !== false) {
    return null;
  }

  return odtErrorEnvelopeMessage(record) ?? errorMessageFromValue(record.error) ?? "Tool failed";
};

const mcpTransportErrorMessage = (value: CodexAppServerJsonValue | undefined): string | null => {
  const text = nonEmptyString(value);
  return text && /^MCP error\s+-?\d+:/i.test(text) ? text : null;
};

const mcpContentErrorMessage = (value: CodexAppServerJsonValue | undefined): string | null => {
  const text = contentText(value);
  if (!text) {
    return null;
  }
  return odtErrorEnvelopeMessage(text) ?? mcpTransportErrorMessage(text);
};

const dynamicContentErrorMessage = (value: CodexAppServerJsonValue | undefined): string | null => {
  const text = contentText(value);
  return text ? looseErrorEnvelopeMessage(text) : null;
};

const objectField = (value: CodexJsonObject, keys: string[]) => {
  for (const key of keys) {
    const candidate = value[key];
    if (isPlainObject(candidate)) {
      return candidate;
    }
  }
  return null;
};

const failureMarkerMessage = (
  record: CodexJsonObject,
  structuredContent: CodexJsonObject | null,
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

const mcpToolErrorFromValue = (value: CodexAppServerJsonValue | undefined): string | null => {
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

const dynamicToolErrorFromValue = (value: CodexAppServerJsonValue | undefined): string | null => {
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

export const codexMcpToolErrorFromResult = (item: CodexMcpToolCallItem): string | null =>
  item.error?.message ?? mcpToolErrorFromValue(item.result);

export const codexDynamicToolDisplayPayload = (
  item: CodexDynamicToolCallItem,
): CodexDynamicToolCallItem["contentItems"] => item.contentItems;

export const codexDynamicToolErrorFromItem = (item: CodexDynamicToolCallItem): string | null =>
  dynamicToolErrorFromValue(codexDynamicToolDisplayPayload(item)) ??
  (item.success === false || item.status === "failed" ? "Tool failed" : null);

export const codexFileChangeErrorFromItem = (item: CodexFileChangeItem): string | null =>
  item.status === "failed" || item.status === "declined" ? "Tool failed" : null;
