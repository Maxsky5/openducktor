import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type ClaudeSdkSystemMessage<Subtype extends string> = Extract<
  SDKMessage,
  { type: "system"; subtype: Subtype }
>;

/** Exact SDK message types used by the event handlers. */
export type ClaudeSdkAssistantMessageProjection = Extract<SDKMessage, { type: "assistant" }>;
/**
 * The Claude CLI marks its hidden continuation turn with `isMeta`. The SDK type omits
 * the flag, so the projection adds it back for the live-ingress guard.
 */
export type ClaudeSdkUserMessageProjection = Extract<SDKMessage, { type: "user" }> & {
  isMeta?: boolean;
};
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
 * Live SDK messages. User messages carry the CLI's hidden-turn `isMeta` flag, which the
 * SDK type omits and the live-ingress guard filters.
 */
export type ClaudeSdkMessageProjection =
  | ClaudeSdkNonUserMessageProjection
  | ClaudeSdkUserMessageProjection;
