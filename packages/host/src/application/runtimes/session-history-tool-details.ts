import {
  toClaudeOdtToolAliases,
  toOpencodeOdtToolAliases,
  type AgentToolData,
  type AgentToolPart,
  type AgentToolResultContent,
  type OdtToolName,
} from "@openducktor/contracts";
import { normalizeOdtToolName, type AgentSessionHistoryMessage } from "@openducktor/core";
import type { JSONType } from "zod";

/**
 * The characters that a long tool string keeps in compact history. Row summaries read at most
 * 220 characters, and browser rows find the saved screenshot path near the start of the output.
 */
export const TOOL_DETAIL_PREVIEW_LENGTH = 1024;

/** Their rows read the full input, output, and metadata. */
const WHOLE_TOOL_TYPES = new Set<AgentToolPart["toolType"]>(["question", "todo", "file_edit"]);

/** Their rows parse the output as JSON. */
const WHOLE_OUTPUT_TOOLS = new Set<OdtToolName>([
  "odt_search_tasks",
  "odt_create_task",
  "odt_update_task",
  "odt_set_task_artifact",
]);

const odtToolAliases = (name: OdtToolName): string[] => [
  ...toOpencodeOdtToolAliases(name),
  ...toClaudeOdtToolAliases(name),
];

/**
 * Cuts the long strings of finished tool parts and marks each cut part with `detailsOmitted`. A
 * remote client loads the full part with `agent_runtime_load_session_tool_part` when the user opens
 * its details. Running parts stay whole, because live events still update them.
 */
export const withToolDetailsOnDemand = (
  history: AgentSessionHistoryMessage[],
): AgentSessionHistoryMessage[] =>
  history.map((message) =>
    message.role === "system"
      ? message
      : {
          ...message,
          parts: message.parts.map((part) => (part.kind === "tool" ? compact(part) : part)),
        },
  );

const compact = (part: AgentToolPart): AgentToolPart => {
  if (part.status === "pending" || part.status === "running" || WHOLE_TOOL_TYPES.has(part.toolType))
    return part;
  let cut = false;
  const shorten = (text: string): string => {
    if (text.length <= TOOL_DETAIL_PREVIEW_LENGTH) return text;
    cut = true;
    return text.slice(0, TOOL_DETAIL_PREVIEW_LENGTH);
  };
  const shortenJson = (value: JSONType): JSONType => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The tool part schema validated this JSON value.
    if (typeof value === "string") return shorten(value);
    if (Array.isArray(value)) return value.map(shortenJson);
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The tool part schema validated this JSON value.
    return value === null || typeof value !== "object" ? value : shortenData(value);
  };
  const shortenData = (data: AgentToolData): AgentToolData =>
    Object.fromEntries(Object.entries(data).map(([key, item]) => [key, shortenJson(item)]));
  const shortenContent = (content: AgentToolResultContent): AgentToolResultContent => {
    if (content.kind === "text") return { ...content, text: shorten(content.text) };
    const file = { ...content.file };
    if (file.downloadUri !== undefined) file.downloadUri = shorten(file.downloadUri);
    return { ...content, file };
  };
  const result: AgentToolPart = { ...part };
  if (part.input) result.input = shortenData(part.input);
  if (part.metadata) result.metadata = shortenData(part.metadata);
  const tool = normalizeOdtToolName(part.tool, odtToolAliases);
  if (tool === null || !WHOLE_OUTPUT_TOOLS.has(tool)) {
    if (part.output !== undefined) result.output = shorten(part.output);
    if (part.resultContent) result.resultContent = part.resultContent.map(shortenContent);
  }
  if (!cut) return part;
  result.detailsOmitted = true;
  return result;
};

/** The tool part with this part ID and call ID, or null. */
export const findSessionToolPart = (
  history: AgentSessionHistoryMessage[],
  { partId, callId }: { partId: string; callId: string },
): AgentToolPart | null => {
  for (const message of history) {
    if (message.role === "system") continue;
    for (const part of message.parts)
      if (part.kind === "tool" && part.partId === partId && part.callId === callId) return part;
  }
  return null;
};
