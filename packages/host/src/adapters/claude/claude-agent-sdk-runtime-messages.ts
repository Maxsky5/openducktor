import { isRecord, readStringProp } from "./claude-agent-sdk-utils";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";

export type ClaudeTaskNotification = {
  outputFile?: string;
  status: "completed" | "failed" | "stopped";
  summary?: string;
  taskId: string;
  toolUseId?: string;
};

export type ClaudeBackgroundAgentLaunch = {
  agentId: string;
  outputFile?: string;
  status: "async_launched";
};

const readXmlElement = (xml: string, name: string): string | undefined => {
  const openingTag = `<${name}>`;
  const closingTag = `</${name}>`;
  const valueStart = xml.indexOf(openingTag);
  if (valueStart < 0) {
    return undefined;
  }
  const contentStart = valueStart + openingTag.length;
  const valueEnd = xml.indexOf(closingTag, contentStart);
  if (valueEnd < 0) {
    return undefined;
  }
  const value = xml.slice(contentStart, valueEnd).trim();
  return value.length > 0 ? value : undefined;
};

const readXmlElements = (xml: string, name: string): string[] => {
  const values: string[] = [];
  const openingTag = `<${name}>`;
  const closingTag = `</${name}>`;
  let searchFrom = 0;
  while (searchFrom < xml.length) {
    const valueStart = xml.indexOf(openingTag, searchFrom);
    if (valueStart < 0) {
      break;
    }
    const contentStart = valueStart + openingTag.length;
    const valueEnd = xml.indexOf(closingTag, contentStart);
    if (valueEnd < 0) {
      break;
    }
    const value = xml.slice(contentStart, valueEnd).trim();
    if (value.length > 0) {
      values.push(value);
    }
    searchFrom = valueEnd + closingTag.length;
  }
  return values;
};

export const readClaudeTaskNotifications = (
  entry: ClaudeHistoryMessage,
): ClaudeTaskNotification[] => {
  if (!isRecord(entry) || readStringProp(entry, "type") !== "user" || !isRecord(entry.message)) {
    return [];
  }
  const content = readStringProp(entry.message, "content")?.trim();
  if (!content?.startsWith("<task-notification>") || !content.endsWith("</task-notification>")) {
    return [];
  }
  const taskIds = readXmlElements(content, "task-id");
  const toolUseId = readXmlElement(content, "tool-use-id");
  const status = readXmlElement(content, "status");
  if (
    taskIds.length === 0 ||
    (status !== "completed" && status !== "failed" && status !== "stopped")
  ) {
    return [];
  }
  const outputFile = readXmlElement(content, "output-file");
  const summary = readXmlElement(content, "summary");
  return taskIds.map((taskId) => ({
    taskId,
    status,
    ...(toolUseId ? { toolUseId } : undefined),
    ...(outputFile ? { outputFile } : undefined),
    ...(summary ? { summary } : undefined),
  }));
};

export const readClaudeTaskNotification = (
  entry: ClaudeHistoryMessage,
): ClaudeTaskNotification | null => readClaudeTaskNotifications(entry)[0] ?? null;

export const readClaudeBackgroundAgentLaunch = (
  resultText: string,
): ClaudeBackgroundAgentLaunch | null => {
  const lines = resultText.trim().split(/\r?\n/);
  if (!lines[0]?.startsWith("Async agent launched successfully.")) {
    return null;
  }
  const agentIdLine = lines.find((line) => line.startsWith("agentId: "));
  const agentId = agentIdLine?.slice("agentId: ".length).trim().split(/\s/, 1)[0];
  if (!agentId) {
    return null;
  }
  const outputFileLine = lines.find((line) => line.startsWith("output_file: "));
  const outputFile = outputFileLine?.slice("output_file: ".length).trim();
  return {
    agentId,
    status: "async_launched",
    ...(outputFile ? { outputFile } : undefined),
  };
};
