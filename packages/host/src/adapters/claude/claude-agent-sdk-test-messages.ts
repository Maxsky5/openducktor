import type { SDKMessage, SessionMessage, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";

type ClaudeSdkMessageFixture<MessageType extends SDKMessage["type"]> = {
  readonly type: MessageType;
  readonly uuid?: string;
  readonly session_id?: string;
};

/**
 * Keeps intentionally partial SDK event fixtures honest about their public envelope while
 * centralizing the single assertion needed to omit unrelated protocol fields in focused tests.
 */
export const claudeSdkMessageFixture = <
  MessageType extends SDKMessage["type"],
  ExtraFields extends object,
>(
  message: ClaudeSdkMessageFixture<MessageType> & ExtraFields,
): Extract<SDKMessage, { readonly type: MessageType }> &
  ClaudeSdkMessageFixture<MessageType> & {
    readonly uuid: string;
    readonly session_id: string;
  } & ExtraFields =>
  ({ uuid: "fixture-message", session_id: "session-1", ...message }) as unknown as Extract<
    SDKMessage,
    { readonly type: MessageType }
  > &
    ClaudeSdkMessageFixture<MessageType> & {
      readonly uuid: string;
      readonly session_id: string;
    } & ExtraFields;

type ClaudeSessionMessageFixture = {
  readonly type: SessionMessage["type"];
  readonly uuid: string;
  readonly session_id?: string;
  readonly message: unknown;
  readonly parent_tool_use_id?: string | null;
};

/** Builds the complete public SessionMessage envelope and preserves extra mirrored metadata. */
export const claudeSessionMessageFixture = <Fixture extends ClaudeSessionMessageFixture>(
  message: Fixture,
): SessionMessage => ({
  ...message,
  session_id: message.session_id ?? "session-1",
  parent_tool_use_id: message.parent_tool_use_id ?? null,
});

export const claudeSessionMessageFixtures = (
  messages: readonly (ClaudeSessionMessageFixture & Record<string, unknown>)[],
): SessionMessage[] => messages.map(claudeSessionMessageFixture);

/**
 * History imports use the SDK's opaque SessionStoreEntry contract. This helper keeps fixtures
 * constrained to that public contract before exposing the adapter's filtered history union.
 */
export const claudeHistoryMessageFixtures = (
  messages: readonly SessionStoreEntry[],
): ClaudeHistoryMessage[] => messages as ClaudeHistoryMessage[];
