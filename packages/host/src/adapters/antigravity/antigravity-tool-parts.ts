import type {
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk/unstable";
import type { AgentToolPart, FileDiff } from "@openducktor/contracts";
import { countRenderableFileDiffLines } from "@openducktor/core";
import { createTwoFilesPatch } from "diff";
import {
  readAntigravityCommandOutput,
  readAntigravityExitCode,
  readAntigravityMcpCall,
  readAntigravityToolInput,
} from "./antigravity-native-payloads";

type ToolType = AgentToolPart["toolType"];

/** The native fields of one tool call, merged from its `tool_call` and `tool_call_update` updates. */
export type AntigravityToolState = {
  toolCallId: string;
  title?: string | undefined;
  name?: string | undefined;
  kind?: ToolKind | undefined;
  status?: ToolCall["status"] | undefined;
  content?: ToolCallContent[] | undefined;
  rawInput?: ToolCallUpdate["rawInput"];
  rawOutput?: ToolCallUpdate["rawOutput"];
};

/** The shared tool type of each ACP tool kind. Other kinds are generic. */
const toolTypeForKind = (kind: ToolKind | undefined): ToolType => {
  switch (kind) {
    case "read":
      return "read";
    case "edit":
    case "delete":
    case "move":
      return "file_edit";
    case "search":
      return "search";
    case "execute":
      return "bash";
    case "fetch":
      return "web";
    default:
      return "generic";
  }
};

const contentText = (content: ToolCallContent[] | undefined): string => {
  const lines: string[] = [];
  for (const entry of content ?? []) {
    if (entry.type === "content" && entry.content.type === "text") lines.push(entry.content.text);
  }
  return lines.join("\n");
};

/** The file changes of an edit, from the ACP `diff` content of its tool call. */
const toFileDiffs = (content: ToolCallContent[] | undefined): FileDiff[] =>
  (content ?? []).flatMap((entry) => {
    if (entry.type !== "diff") return [];
    const oldText = entry.oldText ?? null;
    const diff = createTwoFilesPatch(entry.path, entry.path, oldText ?? "", entry.newText, "", "", {
      context: 3,
    });
    const counts = countRenderableFileDiffLines(diff);
    return [
      {
        file: entry.path,
        type: oldText === null ? "added" : "modified",
        additions: counts.additions,
        deletions: counts.deletions,
        diff,
      },
    ];
  });

/**
 * The shared names of the native tools that other runtimes also have, so their rows read alike.
 * The part keeps the native name in `tool` for the call details.
 */
const DISPLAY_LABELS = new Map([
  ["read_file", "read"],
  ["write_file", "write"],
  ["edit_file", "edit"],
  ["search_web", "websearch"],
]);

const FILE_TOOL_KINDS: ReadonlySet<ToolKind> = new Set(["read", "edit", "delete", "move"]);

const DECLINED_TOOL_ERROR = "The user or a policy declined this tool call.";

/** Builds the shared tool part of a native tool call. */
export const toAntigravityToolPart = (
  state: AntigravityToolState,
  messageId: string,
  declined: boolean,
): AgentToolPart => {
  const mcp = readAntigravityMcpCall(state);
  const managedMcp = mcp?.managed === true;
  const tool = mcp
    ? managedMcp
      ? mcp.toolName
      : `${mcp.serverName}.${mcp.toolName}`
    : (state.name ?? state.title ?? "tool");
  const output = readAntigravityCommandOutput(state) ?? contentText(state.content);
  const exitCode = readAntigravityExitCode(state);
  const part: AgentToolPart = {
    kind: "tool",
    messageId,
    partId: messageId,
    callId: state.toolCallId,
    tool,
    toolType: managedMcp ? "workflow" : toolTypeForKind(state.kind),
    status: "running",
  };
  const displayLabel = mcp ? undefined : DISPLAY_LABELS.get(tool);
  if (displayLabel) part.displayLabel = displayLabel;
  // A file tool has the title "File <path from the home directory>", and a managed or other
  // tool "Run <native name>". The shared rows show the path and the tool name instead.
  if (
    state.title &&
    !managedMcp &&
    !FILE_TOOL_KINDS.has(state.kind ?? "other") &&
    state.title !== `Run ${state.name}`
  ) {
    part.title = state.title;
  }
  const input = mcp ? mcp.args : readAntigravityToolInput(state);
  if (input) part.input = input;
  if (output) part.output = output;
  const fileDiffs = toFileDiffs(state.content);
  if (fileDiffs.length > 0) part.fileDiffs = fileDiffs;
  if (exitCode !== null) part.metadata = { exit: exitCode };
  if (declined) {
    part.status = "error";
    part.error = DECLINED_TOOL_ERROR;
    return part;
  }
  switch (state.status) {
    case "pending":
      part.status = "pending";
      break;
    case "completed":
      if (exitCode !== null && exitCode !== 0) {
        part.status = "error";
        part.error = `Command exited with code ${exitCode}.`;
      } else {
        part.status = "completed";
      }
      break;
    case "failed":
      part.status = "error";
      part.error = output || "Antigravity reported that the tool failed.";
      break;
    default:
      part.status = "running";
  }
  return part;
};

/** Merges a `tool_call` or `tool_call_update` into the state of its tool call. */
export const mergeAntigravityToolState = (
  previous: AntigravityToolState | undefined,
  update: ToolCall | ToolCallUpdate,
): AntigravityToolState => {
  const next: AntigravityToolState = { ...previous, toolCallId: update.toolCallId };
  if (update.title) next.title = update.title;
  if (update.name) next.name = update.name;
  if (update.kind) next.kind = update.kind;
  if (update.status) next.status = update.status;
  if (update.content) next.content = update.content;
  if (update.rawInput !== undefined) next.rawInput = update.rawInput;
  if (update.rawOutput !== undefined) next.rawOutput = update.rawOutput;
  return next;
};
