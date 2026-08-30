import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type ClaudeSdkSystemMessage<Subtype extends string> = Extract<
  SDKMessage,
  { type: "system"; subtype: Subtype }
>;

/** Exact SDK message types used by the event handlers. */
export type ClaudeSdkAssistantMessageProjection = Extract<SDKMessage, { type: "assistant" }>;
export type ClaudeSdkUserMessageProjection = Extract<SDKMessage, { type: "user" }>;
export type ClaudeSdkResultMessageProjection = Extract<SDKMessage, { type: "result" }>;
export type ClaudeSdkStreamEventMessageProjection = Extract<SDKMessage, { type: "stream_event" }>;
export type ClaudeSdkToolProgressMessageProjection = Extract<SDKMessage, { type: "tool_progress" }>;
export type ClaudeSdkModelRefusalFallbackMessageProjection =
  ClaudeSdkSystemMessage<"model_refusal_fallback">;
export type ClaudeSdkSubagentSystemMessageProjection = ClaudeSdkSystemMessage<
  "task_started" | "task_progress" | "task_updated" | "task_notification"
>;
export type ClaudeSdkMessageProjection = SDKMessage;
