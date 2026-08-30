import type {
  ModelUsage,
  NonNullableUsage,
  SDKMessage,
  SessionMessage,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { createHash, type UUID } from "node:crypto";
import { z } from "zod";
import {
  filterClaudeHistoryMessages,
  type ClaudeHistoryConversationMessage,
  type ClaudeHistoryMessage,
} from "./claude-agent-sdk-history-import";

const defaultClaudeSdkMessageUuid = "00000000-0000-4000-8000-000000000001" satisfies UUID;
const claudeSdkMessageUuidSchema = z.custom<UUID>((value) => z.uuid().safeParse(value).success);

export const claudeSdkMessageUuidFixture = (label: string): UUID => {
  const hash = createHash("sha256").update(label).digest("hex");
  return claudeSdkMessageUuidSchema.parse(
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
  );
};

type ClaudeSdkAssistantMessage = Extract<SDKMessage, { type: "assistant" }>;
type ClaudeSdkUserMessage = Extract<SDKMessage, { type: "user" }>;
type ClaudeSdkCompleteUserMessage = ClaudeSdkUserMessage & {
  session_id: string;
  uuid: UUID;
};
type ClaudeSdkResultMessage = Extract<SDKMessage, { type: "result" }>;
type ClaudeSdkStreamEventMessage = Extract<SDKMessage, { type: "stream_event" }>;
type ClaudeSdkToolProgressMessage = Extract<SDKMessage, { type: "tool_progress" }>;
type ClaudeSdkUsedSystemSubtype =
  | "commands_changed"
  | "compact_boundary"
  | "local_command_output"
  | "model_refusal_fallback"
  | "permission_denied"
  | "session_state_changed"
  | "task_notification"
  | "task_progress"
  | "task_started"
  | "task_updated";
type ClaudeSdkUsedSystemMessage = Extract<
  SDKMessage,
  { type: "system"; subtype: ClaudeSdkUsedSystemSubtype }
>;
type ClaudeSdkFixtureMessage =
  | ClaudeSdkAssistantMessage
  | ClaudeSdkUserMessage
  | ClaudeSdkResultMessage
  | ClaudeSdkStreamEventMessage
  | ClaudeSdkToolProgressMessage
  | ClaudeSdkUsedSystemMessage;

type ClaudeAssistantContentBlock = ClaudeSdkAssistantMessage["message"]["content"][number];
type ClaudeAssistantTextBlock = Extract<ClaudeAssistantContentBlock, { type: "text" }>;
type ClaudeAssistantThinkingBlock = Extract<ClaudeAssistantContentBlock, { type: "thinking" }>;
type ClaudeAssistantMcpToolUseBlock = Extract<
  ClaudeAssistantContentBlock,
  { type: "mcp_tool_use" }
>;
type ClaudeAssistantContentBlockFixture =
  | (Omit<ClaudeAssistantTextBlock, "citations"> &
      Partial<Pick<ClaudeAssistantTextBlock, "citations">>)
  | (Omit<ClaudeAssistantThinkingBlock, "signature"> &
      Partial<Pick<ClaudeAssistantThinkingBlock, "signature">>)
  | (Omit<ClaudeAssistantMcpToolUseBlock, "server_name"> &
      Partial<Pick<ClaudeAssistantMcpToolUseBlock, "server_name">>)
  | Exclude<
      ClaudeAssistantContentBlock,
      ClaudeAssistantTextBlock | ClaudeAssistantThinkingBlock | ClaudeAssistantMcpToolUseBlock
    >;
type ClaudeAssistantMessageFixture = Omit<
  Partial<ClaudeSdkAssistantMessage["message"]>,
  "content" | "usage"
> & {
  content?: readonly ClaudeAssistantContentBlockFixture[];
  usage?: Partial<ClaudeSdkAssistantMessage["message"]["usage"]>;
};
type ClaudeSdkAssistantMessageFixtureInput = Omit<
  Partial<ClaudeSdkAssistantMessage>,
  "message" | "type"
> & {
  message: ClaudeAssistantMessageFixture;
  type: "assistant";
};
type ClaudeUserContentBlock = Exclude<ClaudeSdkUserMessage["message"]["content"], string>[number];
type ClaudeUserToolResultBlock = Extract<ClaudeUserContentBlock, { type: "tool_result" }>;
type ClaudeUserToolResultContent = Exclude<
  ClaudeUserToolResultBlock["content"],
  string | undefined
>;
type ClaudeUserContentBlockFixture =
  | (Omit<ClaudeUserToolResultBlock, "content"> & {
      content?: string | readonly ClaudeUserToolResultContent[number][];
    })
  | Exclude<ClaudeUserContentBlock, ClaudeUserToolResultBlock>;
type ClaudeSdkUserMessageFixtureInput = Omit<Partial<ClaudeSdkUserMessage>, "message" | "type"> & {
  message: Omit<Partial<ClaudeSdkUserMessage["message"]>, "content"> & {
    content: string | readonly ClaudeUserContentBlockFixture[];
  };
  type: "user";
};

type ClaudeStreamEvent = ClaudeSdkStreamEventMessage["event"];
type ClaudeMessageStartEvent = Extract<ClaudeStreamEvent, { type: "message_start" }>;
type ClaudeContentBlockDeltaEvent = Extract<ClaudeStreamEvent, { type: "content_block_delta" }>;
type ClaudeThinkingDelta = Extract<
  ClaudeContentBlockDeltaEvent["delta"],
  { type: "thinking_delta" }
>;
type ClaudeStreamEventFixture =
  | (Omit<ClaudeMessageStartEvent, "message"> & { message?: ClaudeAssistantMessageFixture })
  | (Omit<ClaudeContentBlockDeltaEvent, "delta"> & {
      delta:
        | (Omit<ClaudeThinkingDelta, "estimated_tokens"> &
            Partial<Pick<ClaudeThinkingDelta, "estimated_tokens">>)
        | Exclude<ClaudeContentBlockDeltaEvent["delta"], ClaudeThinkingDelta>;
    })
  | Exclude<ClaudeStreamEvent, ClaudeMessageStartEvent | ClaudeContentBlockDeltaEvent>;
type ClaudeSdkStreamEventMessageFixtureInput = Omit<
  Partial<ClaudeSdkStreamEventMessage>,
  "event" | "type"
> & {
  event: ClaudeStreamEventFixture;
  type: "stream_event";
};

type DiscriminatedFixtureInput<Message extends ClaudeSdkFixtureMessage> =
  Message extends ClaudeSdkFixtureMessage
    ? Message extends { subtype: string }
      ? Pick<Message, "subtype" | "type"> & Partial<Omit<Message, "subtype" | "type">>
      : Pick<Message, "type"> & Partial<Omit<Message, "type">>
    : never;

type ClaudeModelUsageFixture = Record<string, Partial<ModelUsage>>;

type ClaudeSdkResultMessageFixtureInput = ClaudeSdkResultMessage extends infer Message
  ? Message extends ClaudeSdkResultMessage
    ? Omit<DiscriminatedFixtureInput<Message>, "modelUsage" | "usage"> & {
        modelUsage?: ClaudeModelUsageFixture;
        usage?: Partial<NonNullableUsage>;
      }
    : never
  : never;

type ClaudeSdkMessageFixtureInput =
  | ClaudeSdkAssistantMessageFixtureInput
  | ClaudeSdkUserMessageFixtureInput
  | ClaudeSdkResultMessageFixtureInput
  | ClaudeSdkStreamEventMessageFixtureInput
  | DiscriminatedFixtureInput<ClaudeSdkToolProgressMessage | ClaudeSdkUsedSystemMessage>;

type ClaudeSdkFixtureOutput<Input extends ClaudeSdkMessageFixtureInput> = Input extends {
  type: "assistant";
}
  ? ClaudeSdkAssistantMessage
  : Input extends { type: "user" }
    ? ClaudeSdkCompleteUserMessage
    : Input extends { type: "result"; subtype: infer Subtype }
      ? Extract<ClaudeSdkResultMessage, { subtype: Subtype }>
      : Input extends { type: "stream_event" }
        ? ClaudeSdkStreamEventMessage
        : Input extends { type: "tool_progress" }
          ? ClaudeSdkToolProgressMessage
          : Input extends { type: "system"; subtype: infer Subtype }
            ? Extract<ClaudeSdkUsedSystemMessage, { subtype: Subtype }>
            : never;

const isClaudeUserToolResultContentArray = (
  content: string | readonly ClaudeUserToolResultContent[number][],
): content is readonly ClaudeUserToolResultContent[number][] => Array.isArray(content);

const completeClaudeAssistantContentBlock = (
  block: ClaudeAssistantContentBlockFixture,
): ClaudeAssistantContentBlock => {
  if (block.type === "text") return { citations: null, ...block };
  if (block.type === "thinking") return { signature: "test-signature", ...block };
  if (block.type === "mcp_tool_use") return { server_name: "test-server", ...block };
  return block;
};

const completeClaudeAssistantMessage = (
  message: ClaudeAssistantMessageFixture,
  defaultMessageId: string,
): ClaudeSdkAssistantMessage["message"] => {
  const usage = {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    fallback_credit: null,
    inference_geo: null,
    input_tokens: 0,
    iterations: null,
    output_tokens: 0,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
    ...message.usage,
  } satisfies ClaudeSdkAssistantMessage["message"]["usage"];
  return {
    id: defaultMessageId,
    container: null,
    context_management: null,
    diagnostics: null,
    model: "claude-test",
    role: "assistant",
    stop_details: null,
    stop_reason: null,
    stop_sequence: null,
    type: "message",
    ...message,
    content: (message.content ?? []).map(completeClaudeAssistantContentBlock),
    usage,
  };
};

const completeClaudeUserContentBlock = (
  block: ClaudeUserContentBlockFixture,
): ClaudeUserContentBlock => {
  if (block.type !== "tool_result") return block;
  const { content, ...toolResult } = block;
  if (content === undefined) return toolResult;
  if (!isClaudeUserToolResultContentArray(content)) return { ...toolResult, content };
  return { ...toolResult, content: content.map((entry) => entry) };
};

const isClaudeUserContentBlockFixtureArray = (
  content: string | readonly ClaudeUserContentBlockFixture[],
): content is readonly ClaudeUserContentBlockFixture[] => Array.isArray(content);

const completeClaudeStreamEvent = (
  event: ClaudeStreamEventFixture,
  defaultMessageId: string,
): ClaudeStreamEvent => {
  if (event.type === "message_start") {
    return {
      ...event,
      message: completeClaudeAssistantMessage(event.message ?? {}, defaultMessageId),
    };
  }
  if (event.type === "content_block_delta") {
    const delta =
      event.delta.type === "thinking_delta" ? { estimated_tokens: 0, ...event.delta } : event.delta;
    return { ...event, delta };
  }
  return event;
};

const completeClaudeResultUsage = (
  usage: Partial<NonNullableUsage> | undefined,
): NonNullableUsage => ({
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  fallback_credit: { status: { reason: "not_enabled", type: "not_applied" } },
  inference_geo: "test",
  input_tokens: 0,
  iterations: [],
  output_tokens: 0,
  output_tokens_details: { thinking_tokens: 0 },
  server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
  service_tier: "standard",
  speed: "standard",
  ...usage,
});

const completeClaudeModelUsage = (
  modelUsage: ClaudeModelUsageFixture | undefined,
): ClaudeSdkResultMessage["modelUsage"] =>
  Object.fromEntries(
    Object.entries(modelUsage ?? {}).map(([model, usage]) => [
      model,
      {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 0,
        costUSD: 0,
        inputTokens: 0,
        maxOutputTokens: 0,
        outputTokens: 0,
        webSearchRequests: 0,
        ...usage,
      },
    ]),
  );

export function claudeSdkMessageFixture<const Input extends ClaudeSdkMessageFixtureInput>(
  message: Input,
): ClaudeSdkFixtureOutput<Input>;
export function claudeSdkMessageFixture(
  message: ClaudeSdkMessageFixtureInput,
): ClaudeSdkFixtureMessage {
  const uuid = message.uuid ?? defaultClaudeSdkMessageUuid;
  const session_id = message.session_id ?? "session-1";

  if (message.type === "assistant") {
    return {
      parent_tool_use_id: null,
      ...message,
      message: completeClaudeAssistantMessage(message.message, uuid),
      session_id,
      uuid,
    };
  }
  if (message.type === "user") {
    const content = isClaudeUserContentBlockFixtureArray(message.message.content)
      ? message.message.content.map(completeClaudeUserContentBlock)
      : message.message.content;
    return {
      parent_tool_use_id: null,
      ...message,
      message: { role: "user", ...message.message, content },
      session_id,
      uuid,
    };
  }
  if (message.type === "result") {
    if (message.subtype === "success") {
      return {
        duration_api_ms: 0,
        duration_ms: 0,
        is_error: false,
        num_turns: 0,
        permission_denials: [],
        result: "",
        stop_reason: null,
        total_cost_usd: 0,
        ...message,
        modelUsage: completeClaudeModelUsage(message.modelUsage),
        session_id,
        usage: completeClaudeResultUsage(message.usage),
        uuid,
      };
    }
    return {
      duration_api_ms: 0,
      duration_ms: 0,
      errors: [],
      is_error: true,
      num_turns: 0,
      permission_denials: [],
      stop_reason: null,
      total_cost_usd: 0,
      ...message,
      modelUsage: completeClaudeModelUsage(message.modelUsage),
      session_id,
      usage: completeClaudeResultUsage(message.usage),
      uuid,
    };
  }
  if (message.type === "stream_event") {
    return {
      parent_tool_use_id: null,
      ...message,
      event: completeClaudeStreamEvent(message.event, uuid),
      session_id,
      uuid,
    };
  }
  if (message.type === "tool_progress") {
    return {
      elapsed_time_seconds: 0,
      parent_tool_use_id: null,
      tool_name: "TestTool",
      tool_use_id: "tool-use-1",
      ...message,
      session_id,
      uuid,
    };
  }

  switch (message.subtype) {
    case "commands_changed":
      return { commands: [], ...message, session_id, uuid };
    case "compact_boundary":
      return {
        compact_metadata: { pre_tokens: 0, trigger: "manual" },
        ...message,
        session_id,
        uuid,
      };
    case "local_command_output":
      return { content: "", ...message, session_id, uuid };
    case "model_refusal_fallback":
      return {
        content: "",
        direction: "retry",
        fallback_model: "claude-test-fallback",
        original_model: "claude-test",
        request_id: null,
        trigger: "refusal",
        ...message,
        session_id,
        uuid,
      };
    case "permission_denied":
      return {
        message: "Permission denied",
        tool_name: "TestTool",
        tool_use_id: "tool-use-1",
        ...message,
        session_id,
        uuid,
      };
    case "session_state_changed":
      return { state: "idle", ...message, session_id, uuid };
    case "task_notification":
      return {
        output_file: "/tmp/task-output",
        status: "completed",
        summary: "Task completed",
        task_id: "task-1",
        ...message,
        session_id,
        uuid,
      };
    case "task_progress":
      return {
        description: "Task in progress",
        task_id: "task-1",
        usage: { duration_ms: 0, tool_uses: 0, total_tokens: 0 },
        ...message,
        session_id,
        uuid,
      };
    case "task_started":
      return {
        description: "Task started",
        task_id: "task-1",
        ...message,
        session_id,
        uuid,
      };
    case "task_updated":
      return { patch: {}, task_id: "task-1", ...message, session_id, uuid };
  }
}

export const claudeHistoryMessagesFixture = (
  messages: readonly ClaudeHistoryMessage[],
): ClaudeHistoryMessage[] => [...messages];

type ClaudeSessionMessageFixture = SessionStoreEntry & {
  readonly type: SessionMessage["type"];
  readonly uuid: string;
  readonly session_id?: string;
  readonly message: SessionMessage["message"];
  readonly parent_tool_use_id?: string | null;
  readonly parent_agent_id?: string | null;
};

/** Builds the complete public SessionMessage envelope and preserves extra mirrored metadata. */
export const claudeSessionMessageFixture = <Fixture extends ClaudeSessionMessageFixture>(
  message: Fixture,
): SessionMessage & Fixture => ({
  ...message,
  session_id: message.session_id ?? "session-1",
  parent_tool_use_id: message.parent_tool_use_id ?? null,
  parent_agent_id: message.parent_agent_id ?? null,
});

export const claudeSessionMessageFixtures = (
  messages: readonly ClaudeSessionMessageFixture[],
): ClaudeHistoryConversationMessage[] => messages.map(claudeSessionMessageFixture);

export const claudeHistoryMessageFixtures = (
  messages: readonly SessionStoreEntry[],
): ClaudeHistoryMessage[] => filterClaudeHistoryMessages(messages);
