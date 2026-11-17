import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client";

type UserInput = {
  readonly text: string;
  readonly files?: ReadonlyArray<unknown> | undefined;
  readonly agents?: ReadonlyArray<unknown> | undefined;
  readonly skills?: ReadonlyArray<unknown> | undefined;
};

/**
 * OpenCode has no continuation call, so Resume sends a prompt with no input. OpenCode stores it
 * as an empty user row and leaves it out of the model context. It is not a message of the user,
 * so history and live updates must not show it.
 */
export const isOpenCodeContinuationInput = (input: UserInput): boolean =>
  input.text === "" && !input.files?.length && !input.agents?.length && !input.skills?.length;

/** The empty user row of a continuation. */
export const isOpenCodeContinuationMessage = (message: SessionMessageInfo): boolean =>
  message.type === "user" && isOpenCodeContinuationInput(message);

/** A user message that starts a turn. A continuation row continues the turn before it. */
export const isOpenCodeUserTurn = (message: SessionMessageInfo): boolean =>
  message.type === "user" && !isOpenCodeContinuationInput(message);

export type OpenCodeLatestTurn = "unfinished" | "completed" | "none";

/**
 * The state of the latest turn of a conversation. An `idle` record that `succeeded` after the
 * latest user message ends that turn. A failed or interrupted turn stays unfinished.
 */
export const openCodeLatestTurn = (messages: readonly SessionMessageInfo[]): OpenCodeLatestTurn => {
  const latestUser = messages.findLastIndex(isOpenCodeUserTurn);
  if (latestUser < 0) return "none";
  return messages
    .slice(latestUser + 1)
    .some((message) => message.type === "idle" && message.outcome === "succeeded")
    ? "completed"
    : "unfinished";
};

/**
 * Reads the state of the latest turn. It pages the history from the newest message and stops at
 * the user message that starts the turn, so a long conversation costs one page.
 */
export const readOpenCodeLatestTurn = async (
  client: OpenCodeClient,
  sessionID: string,
): Promise<OpenCodeLatestTurn> => {
  const newestFirst: SessionMessageInfo[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    // The cursor keeps the requested order across pages.
    const page = await client.message.list({
      sessionID,
      limit: 100,
      ...(cursor ? { cursor } : { order: "desc" }),
    });
    newestFirst.push(...page.data);
    if (page.data.some(isOpenCodeUserTurn)) break;
    cursor = page.cursor.next ?? undefined;
    if (cursor && seen.has(cursor))
      throw new Error(
        "OpenCode repeated a history cursor. Retry after updating the selected runtime.",
      );
    if (cursor) seen.add(cursor);
  } while (cursor);
  return openCodeLatestTurn(newestFirst.toReversed());
};
