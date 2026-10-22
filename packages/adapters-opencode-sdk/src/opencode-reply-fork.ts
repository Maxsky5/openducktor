import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import type { SessionRef } from "@openducktor/core";
import { operationError } from "./opencode-client";
import { completedOpenCodeReplies, readMessages } from "./opencode-message-projection";

export const readReplyForkBoundary = async (
  client: OpenCodeClient,
  source: SessionRef,
  messageId: string,
): Promise<NonNullable<SessionInfo["fork"]>["boundary"]> => {
  const messages = await readMessages(client, source.externalSessionId);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0 || !completedOpenCodeReplies(messages).has(messageId))
    throw operationError(
      source,
      "fork the conversation",
      "unsupported_operation",
      "The selected reply is absent or its native turn has not completed successfully.",
      "Reload the conversation and select a completed reply.",
    );
  const nextUserIndex = messages.findIndex(
    (message, position) => position > index && message.type === "user",
  );
  const end = nextUserIndex === -1 ? messages.length : nextUserIndex;
  if (messages.slice(index + 1, end).some((message) => message.type === "assistant"))
    throw operationError(
      source,
      "fork the conversation",
      "unsupported_operation",
      "A later native assistant message prevents an exact fork at this reply.",
      "Reload the conversation and select the final completed reply of that turn.",
    );
  const nextUser = nextUserIndex === -1 ? undefined : messages[nextUserIndex];
  const endpoint = messages.at(-1);
  if (!endpoint) throw new Error("The selected native reply has no history endpoint.");
  return nextUser
    ? { type: "before", messageID: nextUser.id }
    : { type: "through", messageID: endpoint.id };
};

export const checkReplyForkBoundary = (
  source: SessionRef,
  detail: SessionInfo,
  boundary: NonNullable<SessionInfo["fork"]>["boundary"],
): void => {
  if (
    detail.parentID ||
    detail.fork?.sessionID !== source.externalSessionId ||
    detail.fork?.boundary?.type !== boundary?.type ||
    detail.fork?.boundary?.messageID !== boundary?.messageID
  )
    throw operationError(
      source,
      "fork the conversation",
      "identity_mismatch",
      "The native fork returned a different history boundary. The source may have changed during the fork.",
      "Reload the source conversation and select the intended completed reply again.",
    );
};

export const requireIdleFork = async (client: OpenCodeClient, ref: SessionRef): Promise<void> => {
  const active = await client.session.active();
  if (active[ref.externalSessionId])
    throw operationError(
      ref,
      "fork the conversation",
      "invalid_runtime_response",
      "The new native conversation started work before the fork completed.",
      "Check the native fork behavior in OpenCode, then retry the fork.",
    );
};
