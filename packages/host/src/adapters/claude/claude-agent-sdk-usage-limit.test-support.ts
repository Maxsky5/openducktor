import type { SDKRateLimitEvent, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import {
  claudeSdkMessageFixture,
  claudeSdkMessageUuidFixture,
} from "./claude-agent-sdk-test-messages";

export const claudeTaskNotificationWakeFixture = (
  id: string,
  overrides: {
    sessionId?: string;
    content?: string;
    isSynthetic?: boolean;
    shouldQuery?: boolean;
  } = {},
) => {
  const {
    sessionId = "session-1",
    content = "<task-notification>done</task-notification>",
    ...rest
  } = overrides;
  return claudeSdkMessageFixture({
    type: "user",
    uuid: claudeSdkMessageUuidFixture(id),
    session_id: sessionId,
    parent_tool_use_id: null,
    origin: { kind: "task-notification" },
    message: { role: "user", content },
    ...rest,
  });
};

export const claudeRateLimitEventFixture = (
  info: SDKRateLimitInfo,
  options: { sessionId?: string; uuidLabel?: string } = {},
): SDKRateLimitEvent => ({
  type: "rate_limit_event",
  session_id: options.sessionId ?? "session-1",
  uuid: claudeSdkMessageUuidFixture(options.uuidLabel ?? "rate-limit-event"),
  rate_limit_info: info,
});
