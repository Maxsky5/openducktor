import type { SDKMessage, SessionMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import type { JsonValue } from "@openducktor/contracts";

type ClaudeSdkMessageFixture<MessageType extends SDKMessage["type"]> = {
  readonly type: MessageType;
  readonly uuid?: string;
  readonly session_id?: string;
};

type ClaudeSdkMessageFixtureResult<
  MessageType extends SDKMessage["type"],
  ExtraFields extends object,
> = Extract<SDKMessage, { readonly type: MessageType }> &
  Required<ClaudeSdkMessageFixture<MessageType>> &
  ExtraFields;

/**
 * Keeps intentionally partial SDK event fixtures honest about their public envelope while
 * centralizing the single assertion needed to omit unrelated protocol fields in focused tests.
 */
// SAFETY: The runtime adapter builds this value from the contract fields required by `ClaudeSdkMessageFixtureResult<MessageType, ExtraFields>`.
export const claudeSdkMessageFixture = <
  MessageType extends SDKMessage["type"],
  ExtraFields extends object,
>(
  message: ClaudeSdkMessageFixture<MessageType> & ExtraFields,
): ClaudeSdkMessageFixtureResult<MessageType, ExtraFields> =>
  ({
    uuid: "fixture-message",
    session_id: "session-1",
    ...message,
  }) as ClaudeSdkMessageFixtureResult<MessageType, ExtraFields>;

type ClaudeSessionMessageFixture = {
  readonly type: SessionMessage["type"];
  readonly uuid: string;
  readonly session_id?: string;
  readonly message: unknown;
  readonly parent_tool_use_id?: string | null;
  readonly parent_agent_id?: string | null;
};

/** Builds the complete public SessionMessage envelope and preserves extra mirrored metadata. */
export const claudeSessionMessageFixture = <Fixture extends ClaudeSessionMessageFixture>(
  message: Fixture,
): SessionMessage => ({
  ...message,
  session_id: message.session_id ?? "session-1",
  parent_tool_use_id: message.parent_tool_use_id ?? null,
  parent_agent_id: message.parent_agent_id ?? null,
});

export const claudeSessionMessageFixtures = (
  messages: readonly (ClaudeSessionMessageFixture & Record<string, JsonValue>)[],
): SessionMessage[] => messages.map(claudeSessionMessageFixture);

/**
 * History imports use the SDK's opaque SessionStoreEntry contract. This helper keeps fixtures
 * constrained to that public contract before exposing the adapter's filtered history union.
 */
// SAFETY: The runtime adapter builds this value from the contract fields required by `ClaudeHistoryMessage[]`.
export const claudeHistoryMessageFixtures = (
  messages: readonly SessionStoreEntry[],
): ClaudeHistoryMessage[] => messages as ClaudeHistoryMessage[];
