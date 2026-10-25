import type {
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageSynthetic,
} from "@opencode/client";
import type { AgentTranscriptStreamPart } from "@openducktor/contracts";
import { z } from "zod";

export type ShellContext = {
  results: ReadonlyMap<string, Result>;
  hidden: ReadonlySet<string>;
  signals: ReadonlyMap<string, { noticeId: string; signal: string }>;
};

export const isShellNotice = (
  message: SessionMessageInfo,
): message is SessionMessageSynthetic & { metadata: { source: "shell" } } =>
  message.type === "synthetic" && message.metadata?.source === "shell";

export const shellContext = (messages: readonly SessionMessageInfo[]): ShellContext => {
  const owners = new Map<string, string | null>();
  for (const message of messages) {
    if (message.type === "shell") owners.set(message.shellID, null);
    if (message.type !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "shell" || part.state.status === "streaming")
        continue;
      const shellID = z.string().safeParse(part.state.metadata?.shellID).data;
      if (shellID !== undefined) owners.set(shellID, part.id);
    }
  }
  const results = new Map<string, Result>();
  const hidden = new Set<string>();
  const signals = new Map<string, { noticeId: string; signal: string }>();
  for (const message of messages) {
    if (!isShellNotice(message)) continue;
    const shellID = z.string().safeParse(message.metadata.shellID).data;
    if (shellID === undefined) continue;
    const callID = owners.get(shellID);
    if (callID === undefined) continue;
    hidden.add(message.id);
    if (callID === null) {
      // Shell records omit signals; user shell notices keep them.
      const { signal } = parseMetadata(message);
      if (signal !== undefined) signals.set(shellID, { noticeId: message.id, signal });
    } else results.set(callID, parseResult(message));
  }
  return { results, hidden, signals };
};

/** A tool call can finish while its background shell still runs. */
export const updateShellTool = (
  native: SessionMessageAssistantTool,
  tool: ToolPart,
  context?: ShellContext,
): void => {
  if (native.name !== "shell" || native.state.status === "streaming") return;
  const result = context?.results.get(native.id);
  if (result) {
    setResult(tool, result);
    return;
  }
  if (native.state.status === "completed" && native.state.metadata?.status === "running") {
    tool.status = "running";
    delete tool.endedAtMs;
    tool.metadata = { ...tool.metadata, backgroundTaskStatus: "running" };
  }
};

export const projectShellPart = (
  message: SessionMessageShell | SessionMessageSynthetic,
  context?: ShellContext,
): ToolPart => {
  const tool: ToolPart = {
    kind: "tool",
    messageId: message.id,
    partId: `${message.id}:shell`,
    callId: message.type === "shell" ? message.shellID : message.id,
    tool: "shell",
    toolType: "bash",
    status: "running",
  };
  if (message.type === "synthetic") {
    setResult(tool, parseResult(message));
    if (message.description !== undefined) tool.input = { command: message.description };
    return tool;
  }
  const signal = context?.signals.get(message.shellID)?.signal;
  tool.input = { command: message.command };
  tool.startedAtMs = message.time.created;
  tool.metadata = { shellID: message.shellID, status: message.status };
  if (signal !== undefined) tool.metadata.signal = signal;
  if (message.status !== "running") {
    const cancelled = message.status === "killed";
    const failed =
      message.status === "timeout" ||
      signal !== undefined ||
      (message.exit !== undefined && message.exit !== 0);
    tool.status = cancelled || failed ? "error" : "completed";
    tool.metadata.backgroundTaskStatus = taskStatus(cancelled, failed);
    if (cancelled) tool.error = "Shell command cancelled.";
    else if (message.status === "timeout") tool.error = "Shell command timed out.";
    else if (signal !== undefined) tool.error = `Shell command was killed by ${signal}.`;
    else if (failed) tool.error = `Shell command exited with code ${message.exit}.`;
  }
  if (message.exit !== undefined) tool.metadata.exit = message.exit;
  if (message.time.completed !== undefined) tool.endedAtMs = message.time.completed;
  if (message.output !== undefined) {
    tool.output = outputText(message.output.output, message.output.truncated);
    tool.metadata.truncated = message.output.truncated;
  }
  if (tool.output !== undefined) tool.resultContent = [{ kind: "text", text: tool.output }];
  return tool;
};

type ToolPart = Extract<AgentTranscriptStreamPart, { kind: "tool" }>;
type Result = {
  noticeId: string;
  endedAtMs: number;
  output: string;
  status: "completed" | "error";
  error?: string;
  metadata: NonNullable<ToolPart["metadata"]>;
};

const metadataSchema = z.object({
  state: z.enum(["completed", "cancelled", "error"]),
  shellID: z.string().optional(),
  jobID: z.string().optional(),
  exit: z.number().optional(),
  signal: z.string().optional(),
  timeout: z.boolean().optional(),
  truncated: z.boolean().optional(),
});

const parseMetadata = (message: SessionMessageSynthetic): z.infer<typeof metadataSchema> => {
  const parsed = metadataSchema.safeParse(message.metadata);
  if (!parsed.success)
    throw new Error(
      `OpenCode returned invalid shell result metadata for '${message.id}'. Check the command in OpenCode, then reload this conversation.`,
    );
  return parsed.data;
};

const parseResult = (message: SessionMessageSynthetic): Result => {
  const metadata = parseMetadata(message);
  let output = message.text;
  if (metadata.shellID !== undefined) {
    // ShellResult.notification wraps output for the model; metadata holds the shell ID.
    const prefix = `<shell id="${metadata.jobID ?? metadata.shellID}" state="${metadata.state}" command="${message.description}">\n`;
    const suffix = "\n</shell>";
    if (message.description === undefined || !output.startsWith(prefix) || !output.endsWith(suffix))
      throw new Error(
        `OpenCode returned an invalid shell result envelope for '${message.id}'. Check the command output in OpenCode, then reload this conversation.`,
      );
    output = output.slice(prefix.length, -suffix.length);
  }
  const failed =
    metadata.state === "error" ||
    metadata.timeout === true ||
    metadata.signal !== undefined ||
    (metadata.exit !== undefined && metadata.exit !== 0);
  const cancelled = metadata.state === "cancelled";
  const result: Result = {
    noticeId: message.id,
    endedAtMs: message.time.created,
    output: outputText(output, metadata.truncated),
    status: failed || cancelled ? "error" : "completed",
    metadata: {
      status: metadata.state,
      backgroundTaskStatus: taskStatus(cancelled, failed),
    },
  };
  for (const [key, value] of Object.entries(metadata))
    if (value !== undefined) result.metadata[key] = value;
  if (metadata.shellID !== undefined) result.metadata.backgroundTaskId = metadata.shellID;
  if (cancelled || metadata.state === "error") result.error = output;
  else if (metadata.timeout) result.error = "Shell command timed out.";
  else if (metadata.signal !== undefined)
    result.error = `Shell command was killed by ${metadata.signal}.`;
  else if (failed) result.error = `Shell command exited with code ${metadata.exit}.`;
  return result;
};

const setResult = (tool: ToolPart, result: Result): void => {
  tool.status = result.status;
  tool.output = result.output;
  tool.resultContent = [{ kind: "text", text: result.output }];
  tool.endedAtMs = result.endedAtMs;
  tool.metadata = { ...tool.metadata, ...result.metadata };
  if (result.error !== undefined) tool.error = result.error;
};

const taskStatus = (cancelled: boolean, failed: boolean): "stopped" | "failed" | "completed" => {
  if (cancelled) return "stopped";
  if (failed) return "failed";
  return "completed";
};

const outputText = (output: string, truncated?: boolean): string =>
  truncated ? `${output}\nNative output was truncated.` : output;
