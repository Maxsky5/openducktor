import type { Part } from "@opencode-ai/sdk/v2/client";
import type { AgentStreamPart, AgentSubagentStatus } from "@openducktor/core";

type SubagentStreamPart = Extract<AgentStreamPart, { kind: "subagent" }>;
type TextPart = Extract<Part, { type: "text" }>;

type ParsedTaskResult = {
  externalSessionId: string;
  status: Extract<AgentSubagentStatus, "running" | "completed" | "error">;
  summary?: string;
  resultText?: string;
};

const TASK_OPEN_PREFIX = "<task ";
const TASK_CLOSE_TAG = "</task>";

const readQuotedAttribute = (tag: string, attributeName: string): string | undefined => {
  const marker = ` ${attributeName}="`;
  const markerIndex = tag.indexOf(marker);
  if (markerIndex < 0) {
    return undefined;
  }

  const valueStart = markerIndex + marker.length;
  const valueEnd = tag.indexOf('"', valueStart);
  if (valueEnd < 0) {
    return undefined;
  }

  const value = tag.slice(valueStart, valueEnd).trim();
  return value.length > 0 ? value : undefined;
};

const readInlineElement = (line: string, tagName: string): string | undefined => {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  if (!line.startsWith(openTag) || !line.endsWith(closeTag)) {
    return undefined;
  }

  const value = line.slice(openTag.length, line.length - closeTag.length).trim();
  return value.length > 0 ? value : undefined;
};

const readBlockElement = (lines: string[], tagName: string): string | undefined => {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const openIndex = lines.indexOf(openTag);
  if (openIndex < 0) {
    return undefined;
  }

  const closeIndex = lines.findIndex((line, index) => index > openIndex && line === closeTag);
  if (closeIndex < 0) {
    return undefined;
  }

  const value = lines
    .slice(openIndex + 1, closeIndex)
    .join("\n")
    .trim();
  return value.length > 0 ? value : undefined;
};

const toTaskResultStatus = (value: string | undefined): ParsedTaskResult["status"] | undefined => {
  if (value === "running" || value === "completed" || value === "error") {
    return value;
  }
  return undefined;
};

export const parseOpenCodeBackgroundTaskResult = (value: string): ParsedTaskResult | null => {
  const lines = value
    .trim()
    .split("\n")
    .map((line) => {
      const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
      return normalizedLine.trim();
    })
    .filter((line) => line.length > 0);
  const [openTag] = lines;
  if (!openTag?.startsWith(TASK_OPEN_PREFIX) || !openTag.endsWith(">")) {
    return null;
  }
  if (lines.at(-1) !== TASK_CLOSE_TAG) {
    return null;
  }

  const externalSessionId = readQuotedAttribute(openTag, "id");
  const status = toTaskResultStatus(readQuotedAttribute(openTag, "state"));
  if (!externalSessionId || !status) {
    return null;
  }

  const resultTag = status === "error" ? "task_error" : "task_result";
  const summaryLine = lines.find((line) => line.startsWith("<summary>"));
  const summary = summaryLine ? readInlineElement(summaryLine, "summary") : undefined;
  const resultText = readBlockElement(lines, resultTag);

  return {
    externalSessionId,
    status,
    ...(summary ? { summary } : {}),
    ...(resultText ? { resultText } : {}),
  };
};

const readEndedAtMs = (part: TextPart, timestamp: string | undefined): number | undefined => {
  if (typeof part.time?.end === "number") {
    return part.time.end;
  }
  if (!timestamp) {
    return undefined;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const mapOpenCodeBackgroundTaskResultPart = (
  part: Part,
  options: {
    correlationKey?: string;
    timestamp?: string;
  } = {},
): SubagentStreamPart | null => {
  if (part.type !== "text" || part.synthetic !== true) {
    return null;
  }

  const parsed = parseOpenCodeBackgroundTaskResult(part.text);
  if (!parsed) {
    return null;
  }

  const description = parsed.summary ?? parsed.resultText;
  let endedAtMs: number | undefined;
  if (parsed.status !== "running") {
    endedAtMs = readEndedAtMs(part, options.timestamp);
  }
  return {
    kind: "subagent",
    messageId: part.messageID,
    partId: part.id,
    correlationKey:
      options.correlationKey ?? ["session", part.messageID, parsed.externalSessionId].join(":"),
    status: parsed.status,
    ...(description ? { description } : {}),
    ...(parsed.status === "error" && parsed.resultText ? { error: parsed.resultText } : {}),
    externalSessionId: parsed.externalSessionId,
    executionMode: "background",
    metadata: {
      background: true,
    },
    ...(typeof endedAtMs === "number" ? { endedAtMs } : {}),
  };
};
