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
  type AntigravityMcpCall,
  readAntigravityCommandLine,
  readAntigravityCommandOutput,
  readAntigravityExitCode,
  readAntigravityMcpCall,
  readAntigravityTaskAction,
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
  /** When a live call started and ended. ACP sends no tool times, and a replay has none. */
  startedAtMs?: number | undefined;
  endedAtMs?: number | undefined;
};

/**
 * The shared tool type of an ACP tool kind. `execute` has none: Antigravity also gives it to calls
 * that run no command, such as an MCP call or a `manage_task` call.
 */
const toolTypeForKind = (kind: ToolKind | undefined): Exclude<ToolType, "bash"> => {
  switch (kind) {
    case "read":
      return "read";
    case "edit":
    case "delete":
    case "move":
      return "file_edit";
    case "search":
      return "search";
    case "fetch":
      return "web";
    default:
      return "generic";
  }
};

/**
 * The shared tool type of a native call. Only a call with a command line is a shell command, so no
 * call becomes a shell command with no command. An MCP tool can do anything, so its row is
 * generic.
 */
const toolTypeOf = (state: AntigravityToolState, mcp: AntigravityMcpCall | null): ToolType => {
  if (mcp) return mcp.managed ? "workflow" : "generic";
  if (readAntigravityCommandLine(state) !== null) return "bash";
  return toolTypeForKind(state.kind);
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

/**
 * The diff that a permission request of a file edit gives before the edit runs. The request of an
 * append or an overwrite has no earlier text, so it would show a new file: it gives no preview, and
 * the row keeps its path until the edit completes with the full diff.
 */
export const toAntigravityEditPreview = (toolCall: ToolCallUpdate): ToolCallContent[] | null => {
  if (toolCall.kind !== "edit") return null;
  const input = readAntigravityToolInput(toolCall);
  if (input?.append === true || input?.overwrite === true) return null;
  const diffs = (toolCall.content ?? []).filter((entry) => entry.type === "diff");
  return diffs.length > 0 ? diffs : null;
};

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
    toolType: toolTypeOf(state, mcp),
    status: "running",
  };
  const taskAction = readAntigravityTaskAction(state);
  const displayLabel = mcp ? undefined : DISPLAY_LABELS.get(tool);
  if (displayLabel) part.displayLabel = displayLabel;
  // A file tool has the title "File <path from the home directory>", an MCP tool "MCP Tool
  // <name>", and another tool "Run <native name>". The shared rows show the path, the tool name,
  // and the input instead.
  if (
    state.title &&
    !mcp &&
    !FILE_TOOL_KINDS.has(state.kind ?? "other") &&
    state.title !== `Run ${state.name}`
  ) {
    part.title = state.title;
  }
  if (taskAction) part.title = taskAction;
  if (state.startedAtMs !== undefined) part.startedAtMs = state.startedAtMs;
  if (state.endedAtMs !== undefined) part.endedAtMs = state.endedAtMs;
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
