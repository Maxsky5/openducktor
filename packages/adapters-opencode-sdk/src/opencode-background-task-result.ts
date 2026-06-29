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

const trimOuterEmptyLines = (lines: string[]): string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim().length === 0) {
    start += 1;
  }
  while (end > start && lines[end - 1]?.trim().length === 0) {
    end -= 1;
  }
  return lines.slice(start, end);
};

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

const readElement = (
  lines: string[],
  tagName: string,
  closeSearch: "first" | "last",
): string | undefined => {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const openIndex = lines.findIndex((line) => line.trim().startsWith(openTag));
  if (openIndex < 0) {
    return undefined;
  }

  const openLine = lines[openIndex] ?? "";
  const trimmedOpenLine = openLine.trim();
  if (trimmedOpenLine.endsWith(closeTag)) {
    const inlineValue = trimmedOpenLine.slice(openTag.length, -closeTag.length).trim();
    return inlineValue.length > 0 ? inlineValue : undefined;
  }

  const candidateCloseIndexes = lines
    .map((line, index) => ({ index, line: line.trim() }))
    .filter((candidate) => candidate.index > openIndex && candidate.line.endsWith(closeTag))
    .map((candidate) => candidate.index);
  const closeIndex =
    closeSearch === "last" ? candidateCloseIndexes.at(-1) : candidateCloseIndexes[0];
  if (closeIndex === undefined) {
    return undefined;
  }

  const closeLine = lines[closeIndex] ?? "";
  const trimmedCloseLine = closeLine.trim();
  const valueLines = lines.slice(openIndex + 1, closeIndex);
  const inlineOpenValue = trimmedOpenLine.slice(openTag.length);
  if (inlineOpenValue.length > 0) {
    valueLines.unshift(inlineOpenValue);
  }
  const inlineCloseValue = trimmedCloseLine.slice(0, -closeTag.length);
  if (inlineCloseValue.length > 0) {
    valueLines.push(inlineCloseValue);
  }

  const value = valueLines.join("\n").trim();
  return value.length > 0 ? value : undefined;
};

const toTaskResultStatus = (value: string | undefined): ParsedTaskResult["status"] | undefined => {
  if (value === "running" || value === "completed" || value === "error") {
    return value;
  }
  return undefined;
};

const parseOpenCodeBackgroundTaskResult = (value: string): ParsedTaskResult | null => {
  const lines = trimOuterEmptyLines(
    value.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line)),
  );
  const openTag = lines[0]?.trim();
  if (!openTag?.startsWith(TASK_OPEN_PREFIX) || !openTag.endsWith(">")) {
    return null;
  }
  if (lines.at(-1)?.trim() !== TASK_CLOSE_TAG) {
    return null;
  }

  const bodyLines = lines.slice(1, -1);
  const normalizedBodyLines = bodyLines.map((line) => line.trim());
  const externalSessionId = readQuotedAttribute(openTag, "id");
  const status = toTaskResultStatus(readQuotedAttribute(openTag, "state"));
  if (!externalSessionId || !status) {
    return null;
  }

  const resultTag = status === "error" ? "task_error" : "task_result";
  const summary = readElement(normalizedBodyLines, "summary", "first");
  const resultText = readElement(bodyLines, resultTag, "last");

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
