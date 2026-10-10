import type {
  ModelRef,
  OpenCodeClient,
  SessionInboxUser,
  SessionMessageInfo,
  SessionMessageAssistant,
} from "@opencode/client";
import {
  agentSessionHistoryMessageSchema,
  agentStreamPartSchema,
  agentToolDataSchema,
  fileDiffSchema,
  type AgentSessionHistoryMessage,
  type AgentTranscriptStreamPart,
  type AgentTranscriptUserMessageDisplayPart,
  type AgentTranscriptModelSelection,
  type AgentNativeFileReference,
  type AgentToolResultContent,
} from "@openducktor/contracts";
import { AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX, type AgentEvent } from "@openducktor/core";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { resolveOpencodeToolStrategy } from "./tool-strategy-catalog";
import { detectAgentFileReferenceKind } from "./file-reference-utils";
import type { OpencodeSessionContextUsage } from "./opencode-session-runtime-signals";

export const modelSelection = (model: ModelRef): AgentTranscriptModelSelection => {
  const selection: AgentTranscriptModelSelection = {
    providerId: model.providerID,
    modelId: model.id,
  };
  if (model.variant) selection.variant = model.variant;
  return selection;
};
export const iso = (epoch: number): string => new Date(epoch).toISOString();

type AssistantTokens = NonNullable<Extract<SessionMessageInfo, { type: "assistant" }>["tokens"]>;
const tokenTotal = (tokens: AssistantTokens): number =>
  tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;

/** Match the native TUI: use the last measured assistant after compaction and before a staged revert. */
export const projectContextUsage = (
  messages: readonly SessionMessageInfo[],
  boundary?: string,
): OpencodeSessionContextUsage | null => {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1;
  if (boundary && boundaryIndex === -1) return null;
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex;
  const compactionIndex = messages.findLastIndex(
    (message, index) =>
      message.type === "compaction" && message.status === "completed" && index < end,
  );
  const last = messages.findLast(
    (message, index) =>
      message.type === "assistant" &&
      message.tokens !== undefined &&
      index > compactionIndex &&
      index < end,
  );
  if (last?.type !== "assistant" || !last.tokens) return null;
  const totalTokens = tokenTotal(last.tokens);
  return totalTokens > 0 ? { totalTokens, model: modelSelection(last.model) } : null;
};

const nativeSkillAttachmentsSchema = z.array(
  z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    text: z.string().optional(),
    mention: z
      .object({
        text: z.string(),
        start: z.number().finite(),
        end: z.number().finite(),
      })
      .optional(),
  }),
);

const nativeToolFileDiffsSchema = z.array(
  fileDiffSchema.pick({ file: true, additions: true, deletions: true }).extend({
    patch: z.string(),
    status: z.enum(["added", "deleted", "modified"]),
  }),
);

const nativeWriteInputSchema = z.object({ path: z.string(), content: z.string() });

type UserAttachmentKind = Extract<
  AgentTranscriptUserMessageDisplayPart,
  { kind: "attachment" }
>["attachment"]["kind"];

const attachmentKindFromMime = (mime: string): UserAttachmentKind | null => {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return null;
};

const userDisplay = (
  message: Pick<
    Extract<SessionMessageInfo, { type: "user" }>,
    "text" | "files" | "agents" | "skills"
  >,
  messageId: string,
): AgentTranscriptUserMessageDisplayPart[] => [
  { kind: "text", text: message.text },
  ...(message.files ?? []).map((file, index): AgentTranscriptUserMessageDisplayPart => {
    const snapshotUri = `data:${file.mime};base64,${z.string().parse(file.data)}`;
    const uri = file.source.type === "uri" ? file.source.uri : snapshotUri;
    const path = uri.startsWith("file:") ? fileURLToPath(uri) : uri;
    const attachmentKind = attachmentKindFromMime(file.mime);
    if (!file.mention && attachmentKind)
      return {
        kind: "attachment",
        attachment: {
          id: `${messageId}:attachment:${index}`,
          path: snapshotUri,
          name: file.name ?? `OpenCode ${attachmentKind} attachment`,
          kind: attachmentKind,
          mime: file.mime,
        },
      };
    const part: Extract<AgentTranscriptUserMessageDisplayPart, { kind: "file_reference" }> = {
      kind: "file_reference",
      file: {
        id: path,
        path,
        name: file.name ?? (file.source.type === "uri" ? basename(path) : "OpenCode file"),
        kind: detectAgentFileReferenceKind({
          filePath: path,
          mime: file.mime,
          isDirectory: file.mime === "application/x-directory",
        }),
      },
    };
    if (file.mention)
      part.sourceText = {
        value: file.mention.text,
        start: file.mention.start,
        end: file.mention.end,
      };
    return part;
  }),
  ...(message.agents ?? []).map((agent): AgentTranscriptUserMessageDisplayPart => {
    const part: Extract<AgentTranscriptUserMessageDisplayPart, { kind: "subagent_reference" }> = {
      kind: "subagent_reference",
      subagent: { id: agent.name, name: agent.name },
    };
    if (agent.mention)
      part.sourceText = {
        value: agent.mention.text,
        start: agent.mention.start,
        end: agent.mention.end,
      };
    return part;
  }),
  ...(message.skills === undefined ? [] : nativeSkillAttachmentsSchema.parse(message.skills)).map(
    (skill): AgentTranscriptUserMessageDisplayPart => {
      const part: Extract<AgentTranscriptUserMessageDisplayPart, { kind: "skill_mention" }> = {
        kind: "skill_mention",
        // Native attachments contain a skill ID, not a filesystem path.
        skill: { id: skill.id, name: skill.name, path: skill.id },
      };
      if (skill.mention)
        part.sourceText = {
          value: skill.mention.text,
          start: skill.mention.start,
          end: skill.mention.end,
        };
      return part;
    },
  ),
];

export const projectInboxUser = (
  item: SessionInboxUser,
  state: "queued" | "read" = "queued",
): Extract<AgentEvent, { type: "user_message" }> => ({
  type: "user_message",
  externalSessionId: item.sessionID,
  messageId: item.id,
  timestamp: iso(item.time.created),
  message: item.payload.text,
  parts: userDisplay(item.payload, item.id),
  state,
});

type SubagentCompletion = { state: "completed" | "error" | "cancelled"; created: number };
const subagentCompletions = (
  messages: Iterable<SessionMessageInfo>,
): Map<string, SubagentCompletion> => {
  const completions = new Map<string, SubagentCompletion>();
  const openCalls = new Map<string, string[]>();
  for (const message of messages) {
    if (message.type === "assistant") {
      for (const part of message.content) {
        if (
          part.type !== "tool" ||
          part.name !== "subagent" ||
          part.state.status !== "completed" ||
          !("metadata" in part.state) ||
          part.state.metadata?.status !== "running"
        )
          continue;
        const childID = z.string().safeParse(part.state.metadata.sessionID).data;
        if (childID !== undefined)
          openCalls.set(childID, [...(openCalls.get(childID) ?? []), part.id]);
      }
    }
    if (message.type !== "synthetic" || message.metadata?.source !== "subagent") continue;
    const childID = z.string().safeParse(message.metadata.childID).data;
    const { state } = message.metadata;
    if (
      childID === undefined ||
      (state !== "completed" && state !== "error" && state !== "cancelled")
    )
      continue;
    for (const callID of openCalls.get(childID) ?? [])
      completions.set(callID, { state, created: message.time.created });
    openCalls.delete(childID);
  }
  return completions;
};

const nativeTurnDurations = (messages: Iterable<SessionMessageInfo>): Map<string, number> => {
  const durations = new Map<string, number>();
  let startedAt: number | undefined;
  for (const message of messages) {
    if (message.type === "idle") startedAt = undefined;
    if (message.type !== "assistant") continue;
    startedAt ??= message.time.created;
    if (message.finish === "stop" && !message.error && message.time.completed !== undefined) {
      durations.set(message.id, Math.max(0, message.time.completed - startedAt));
      startedAt = undefined;
    }
  }
  return durations;
};

export type OpenCodeMessageProjectionContext = {
  readonly completions: ReadonlyMap<string, SubagentCompletion>;
  readonly durations: ReadonlyMap<string, number>;
};

export const messageProjectionContext = (
  messages: Iterable<SessionMessageInfo>,
): OpenCodeMessageProjectionContext => {
  const retained = [...messages];
  return { completions: subagentCompletions(retained), durations: nativeTurnDurations(retained) };
};

const isVisibleNativeMessage = (message: SessionMessageInfo): boolean =>
  message.type !== "agent-switched" &&
  !(message.type === "idle" && message.outcome === "succeeded");

export const projectMessages = (messages: SessionMessageInfo[]): AgentSessionHistoryMessage[] => {
  const { completions, durations } = messageProjectionContext(messages);
  return messages
    .filter(isVisibleNativeMessage)
    .map((message) => projectMessage(message, completions, durations.get(message.id)));
};

const projectAssistantContent = (
  message: SessionMessageAssistant,
  content: SessionMessageAssistant["content"][number],
  ordinal: number,
  completions?: ReadonlyMap<string, SubagentCompletion>,
  settledToolInputs?: ReadonlySet<string>,
): AgentTranscriptStreamPart[] => {
  const part = { messageId: message.id };
  if (content.type === "text")
    return [
      {
        ...part,
        kind: "text",
        partId: `${message.id}:text:${ordinal}`,
        text: content.text,
        completed: message.time.completed !== undefined,
      },
    ];
  if (content.type === "reasoning")
    return [
      {
        ...part,
        kind: "reasoning",
        partId: `${message.id}:reasoning:${ordinal}`,
        text: content.text,
        completed: content.time?.completed !== undefined || message.time.completed !== undefined,
      },
    ];
  const state = content.state;
  const resultContent =
    state.status === "completed" || state.status === "error"
      ? state.content?.map((result): AgentToolResultContent => {
          if (result.type === "text") return { kind: "text", text: result.text };
          const file: AgentNativeFileReference = { uri: result.uri, mime: result.mime };
          if (result.name) file.name = result.name;
          return { kind: "file", file };
        })
      : undefined;
  const tool: Extract<AgentTranscriptStreamPart, { kind: "tool" }> = {
    ...part,
    kind: "tool",
    partId: content.id,
    callId: content.id,
    tool: content.name,
    toolType: resolveOpencodeToolStrategy(content.name).toolType,
    status: state.status === "streaming" ? "pending" : state.status,
  };
  if (state.status === "streaming") {
    const settled = settledToolInputs ? settledToolInputs.has(content.id) : state.input.length > 0;
    tool.inputStreaming = !settled;
    if (settled) {
      try {
        tool.input = agentToolDataSchema.parse(JSON.parse(state.input));
      } catch {
        throw new Error(
          `OpenCode returned invalid completed arguments for tool '${content.id}'. Reload the conversation after checking the tool failure in OpenCode.`,
        );
      }
    }
  }
  if (content.time.ran !== undefined) tool.startedAtMs = content.time.ran;
  if (state.status !== "streaming") tool.input = state.input;
  if (resultContent) {
    tool.resultContent = resultContent;
    tool.output = resultContent
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join("\n");
  }
  if (state.status === "error") tool.error = state.error.message;
  if ("metadata" in state && state.metadata) tool.metadata = state.metadata;
  if (
    tool.toolType === "file_edit" &&
    state.status === "completed" &&
    state.metadata?.files !== undefined
  ) {
    const files = nativeToolFileDiffsSchema.safeParse(state.metadata.files);
    if (!files.success)
      throw new Error(
        `OpenCode returned invalid file diffs for tool '${content.id}'. Check the applied changes in OpenCode, then reload the conversation.`,
      );
    tool.fileDiffs = files.data.map(({ file, patch, status, additions, deletions }) => ({
      file,
      diff: patch,
      type: status,
      additions,
      deletions,
    }));
  }
  if (content.name === "write" && state.status === "completed") {
    const input = nativeWriteInputSchema.safeParse(state.input);
    if (input.success)
      tool.fileContent = [{ file: input.data.path, content: input.data.content, type: "modified" }];
  }
  if (content.time.completed !== undefined) tool.endedAtMs = content.time.completed;
  const metadata = "metadata" in state ? state.metadata : undefined;
  if (content.name !== "subagent") return [tool];
  const input =
    state.status === "streaming"
      ? undefined
      : z.record(z.string(), z.json()).safeParse(state.input).data;
  const childID = z.string().safeParse(metadata?.sessionID).data;
  const completion = completions?.get(content.id);
  const status =
    tool.status === "error"
      ? "error"
      : (completion?.state ??
        (tool.status === "completed" && metadata?.status === "running" ? "running" : tool.status));
  const subagent: Extract<AgentTranscriptStreamPart, { kind: "subagent" }> = {
    ...part,
    kind: "subagent",
    partId: `${content.id}:subagent`,
    correlationKey: content.id,
    status,
    executionMode:
      input?.background === true || (tool.status === "completed" && metadata?.status === "running")
        ? "background"
        : "foreground",
    startedAtMs: tool.startedAtMs,
  };
  if (childID) subagent.externalSessionId = childID;
  const agent = z.string().safeParse(input?.agent).data;
  const prompt = z.string().safeParse(input?.prompt).data;
  const description = z.string().safeParse(input?.description).data;
  if (agent !== undefined) subagent.agent = agent;
  if (prompt !== undefined) subagent.prompt = prompt;
  if (description !== undefined) subagent.description = description;
  if (metadata) subagent.metadata = metadata;
  if (tool.error) subagent.error = tool.error;
  else if (completion?.state === "error") subagent.error = "Subagent failed.";
  else if (completion?.state === "cancelled") subagent.error = "Subagent cancelled.";
  if (completion) subagent.endedAtMs = completion.created;
  else if (status !== "running" && tool.endedAtMs !== undefined)
    subagent.endedAtMs = tool.endedAtMs;
  return [tool, subagent];
};

/** History and live events use the same native content order and part IDs. */
export const projectMessage = (
  message: SessionMessageInfo,
  completions?: ReadonlyMap<string, SubagentCompletion>,
  durationMs?: number,
  settledToolInputs?: ReadonlySet<string>,
): AgentSessionHistoryMessage => {
  const base = { messageId: message.id, timestamp: iso(message.time.created) };
  if (message.type === "user")
    return agentSessionHistoryMessageSchema.parse({
      ...base,
      role: "user",
      text: message.text,
      displayParts: userDisplay(message, message.id),
      state: "read",
      parts: [],
    });
  if (message.type === "assistant") {
    let textOrdinal = 0;
    let reasoningOrdinal = 0;
    const parts: AgentTranscriptStreamPart[] = message.content.flatMap((content) => {
      const ordinal =
        content.type === "text"
          ? textOrdinal++
          : content.type === "reasoning"
            ? reasoningOrdinal++
            : 0;
      return projectAssistantContent(message, content, ordinal, completions, settledToolInputs);
    });
    const history: AgentSessionHistoryMessage = {
      ...base,
      role: "assistant",
      text: message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join(""),
      parts,
      model: { ...modelSelection(message.model), profileId: message.agent },
    };
    if (message.error && message.error.type !== "aborted") history.error = message.error.message;
    if (message.time.completed !== undefined && message.finish !== undefined) {
      parts.push({
        kind: "step",
        messageId: message.id,
        partId: `${message.id}:finish`,
        phase: "finish",
        reason: message.finish,
      });
      if (message.finish === "stop" && !message.error && durationMs !== undefined)
        history.durationMs = durationMs;
    }
    if (message.tokens) history.totalTokens = tokenTotal(message.tokens);
    return agentSessionHistoryMessageSchema.parse(history);
  }
  let text: string;
  switch (message.type) {
    case "system":
      text =
        message.metadata?.notice === "instructions"
          ? `${AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX}${message.text}`
          : message.text;
      break;
    case "synthetic":
      text = message.text;
      break;
    case "skill":
      text = `${message.name}\n${message.text}`;
      break;
    case "shell":
      text = `$ ${message.command}\n${message.output?.output ?? ""}\nShell ${message.status}${message.exit !== undefined ? ` (${message.exit})` : ""}${message.output?.truncated ? "\nNative output was truncated." : ""}`;
      break;
    case "compaction":
      text =
        message.status === "completed"
          ? `${message.summary}\n${message.recent}`
          : message.status === "failed"
            ? message.error.message
            : "Session compaction is running.";
      break;
    case "idle":
      text =
        message.outcome === "interrupted"
          ? "Turn interrupted."
          : message.outcome === "failed"
            ? "Turn failed."
            : "Turn completed.";
      break;
    case "agent-switched":
      text = `Agent selected: ${message.agent}`;
      break;
    case "model-switched":
      text = `Model selected: ${message.model.providerID}/${message.model.id}`;
      break;
    case "location-switched":
      text = `Location selected: ${message.location.directory}`;
      break;
    default:
      throw new Error(
        `Unsupported native message type: ${z.object({ type: z.string() }).parse(message).type}. Update OpenDucktor before opening this history.`,
      );
  }
  const history: AgentSessionHistoryMessage = {
    ...base,
    role: "system",
    text,
    parts: [],
  };
  if (message.type === "compaction")
    history.notice =
      message.status === "failed"
        ? { tone: "error", reason: "session_error", title: "Compaction failed" }
        : { tone: "info", reason: "session_compacted", title: "Session compaction" };
  if (message.type === "idle" && message.outcome === "interrupted")
    history.notice = { tone: "cancelled", reason: "session_interrupted", title: "Interrupted" };
  return agentSessionHistoryMessageSchema.parse(history);
};

export const assistantPartEvents = (
  externalSessionId: string,
  message: SessionMessageAssistant,
  selection: { type: "text" | "reasoning"; ordinal: number } | { type: "tool"; id: string },
  context?: OpenCodeMessageProjectionContext,
  settledToolInputs?: ReadonlySet<string>,
): AgentEvent[] => {
  const content =
    selection.type === "tool"
      ? message.content.find((part) => part.type === "tool" && part.id === selection.id)
      : message.content.filter((part) => part.type === selection.type).at(selection.ordinal);
  if (!content) return [];
  return projectAssistantContent(
    message,
    content,
    selection.type === "tool" ? 0 : selection.ordinal,
    context?.completions,
    settledToolInputs,
  ).map((part): AgentEvent => ({
    type: "assistant_part",
    externalSessionId,
    timestamp: iso(message.time.created),
    part: agentStreamPartSchema.parse(part),
  }));
};

export const messageEvents = (
  externalSessionId: string,
  message: SessionMessageInfo,
  context?: OpenCodeMessageProjectionContext,
  settledToolInputs?: ReadonlySet<string>,
): AgentEvent[] => {
  if (!isVisibleNativeMessage(message)) return [];
  const projected = projectMessage(
    message,
    context?.completions,
    context?.durations.get(message.id),
    settledToolInputs,
  );
  const base = { externalSessionId, timestamp: projected.timestamp };
  if (message.type === "idle" && message.outcome === "interrupted")
    return [
      {
        ...base,
        type: "session_idle",
        interruption: { messageId: projected.messageId, message: projected.text },
      },
    ];
  if (projected.role === "user")
    return [
      {
        ...base,
        type: "user_message",
        messageId: projected.messageId,
        message: projected.text,
        parts: projected.displayParts,
        state: projected.state,
      },
    ];
  if (message.type === "compaction")
    return [
      {
        ...base,
        type:
          message.status === "running"
            ? "session_compaction_started"
            : message.status === "completed"
              ? "session_compacted"
              : "turn_error",
        messageId: projected.messageId,
        message: projected.text,
      },
    ];
  if (projected.role === "system")
    return [
      {
        ...base,
        type: "session_policy_notice",
        messageId: projected.messageId,
        message: projected.text,
      },
    ];
  const events = projected.parts.map((part): AgentEvent => ({
    ...base,
    type: "assistant_part",
    part,
  }));
  if (
    message.type === "assistant" &&
    message.time.completed !== undefined &&
    message.finish === "stop" &&
    !message.error
  ) {
    const completed: Extract<AgentEvent, { type: "assistant_message" }> = {
      ...base,
      type: "assistant_message",
      messageId: projected.messageId,
      message: projected.text,
      model: projected.model,
    };
    if (projected.durationMs !== undefined) completed.durationMs = projected.durationMs;
    if (projected.totalTokens !== undefined) completed.totalTokens = projected.totalTokens;
    events.push(completed);
  }
  if (message.type === "assistant" && projected.error)
    events.push({
      ...base,
      type: "turn_error",
      messageId: message.id,
      message: projected.error,
    });
  return events;
};

export const readMessages = async (
  client: OpenCodeClient,
  sessionID: string,
): Promise<SessionMessageInfo[]> => {
  const messages: SessionMessageInfo[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.message.list({
      sessionID,
      limit: 100,
      ...(cursor ? { cursor } : { order: "asc" }),
    });
    messages.push(...page.data);
    cursor = page.cursor.next ?? undefined;
    if (cursor && seen.has(cursor))
      throw new Error(
        "OpenCode repeated a history cursor. Retry history after updating the selected runtime.",
      );
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (new Set(messages.map((message) => message.id)).size !== messages.length)
    throw new Error(
      "OpenCode returned repeated native message IDs. Retry history after updating the selected runtime.",
    );
  return messages;
};
