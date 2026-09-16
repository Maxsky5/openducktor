import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type ClaudeSdkSystemMessage<Subtype extends string> = Extract<
  SDKMessage,
  { type: "system"; subtype: Subtype }
>;

/** Exact SDK message types used by the event handlers. */
export type ClaudeSdkAssistantMessageProjection = Extract<SDKMessage, { type: "assistant" }>;
/**
 * Live user messages carry `isSynthetic` when the CLI adds hidden user-role content, for
 * example the "Continue from where you left off." continuation turn. The live-ingress
 * guard filters that frame.
 */
export type ClaudeSdkUserMessageProjection = Extract<SDKMessage, { type: "user" }>;
export type ClaudeSdkResultMessageProjection = Extract<SDKMessage, { type: "result" }>;
export type ClaudeSdkStreamEventMessageProjection = Extract<SDKMessage, { type: "stream_event" }>;
export type ClaudeSdkToolProgressMessageProjection = Extract<SDKMessage, { type: "tool_progress" }>;
export type ClaudeSdkModelRefusalFallbackMessageProjection =
  ClaudeSdkSystemMessage<"model_refusal_fallback">;
export type ClaudeSdkSubagentSystemMessageProjection = ClaudeSdkSystemMessage<
  "task_started" | "task_progress" | "task_updated" | "task_notification"
>;
type ClaudeSdkNonUserMessageProjection = Exclude<SDKMessage, { type: "user" }>;

/**
 * Live SDK messages. User messages carry the CLI's hidden-turn `isSynthetic` flag, which
 * the live-ingress guard filters.
 */
export type ClaudeSdkMessageProjection =
  | ClaudeSdkNonUserMessageProjection
  | ClaudeSdkUserMessageProjection;
