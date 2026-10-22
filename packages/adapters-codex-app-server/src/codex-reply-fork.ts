import type { CodexAppServerTurn } from "@openducktor/contracts";
import { codexSubAgentSourceMetadata } from "./codex-app-server-threads";
import { codexTurnItemsFromThreadRead } from "./codex-app-server-transcript";
import { parseCodexAsyncQuestionItem } from "./codex-async-questions";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type {
  CodexAppServerClient,
  CodexThreadForkResult,
  CodexThreadHistoryReadResponse,
} from "./types";

type CodexReplyForkBoundary = {
  lastTurnId: string;
  turns: CodexAppServerTurn[];
};

export const resolveCodexReplyForkBoundary = (
  source: CodexThreadHistoryReadResponse,
  messageId: string,
): CodexReplyForkBoundary => {
  if (source.thread.parentThreadId || codexSubAgentSourceMetadata(source.thread.source)) {
    throw new Error(
      "Cannot fork a Codex subagent reply. Open its root session and select a reply.",
    );
  }
  const selected = codexTurnItemsFromThreadRead(source).find(({ item }) => item.id === messageId);
  if (
    !selected?.isFinalAgentMessage ||
    selected.item.type !== "agentMessage" ||
    parseCodexAsyncQuestionItem(selected.item).kind !== "not_async_question"
  ) {
    throw new Error(
      `Codex reply '${messageId}' is not a final reply of a completed turn. Reload the source session and select a completed reply.`,
    );
  }
  return {
    lastTurnId: selected.turn.id,
    turns: source.thread.turns.slice(0, selected.turnIndex + 1),
  };
};

export const prepareCodexReplyForkChild = async ({
  client,
  threadInventory,
  response,
  parentThreadId,
  workingDirectory,
  boundary,
  isRegistered,
}: {
  client: CodexAppServerClient;
  threadInventory: Pick<CodexThreadInventoryReader, "readThreadHistory">;
  response: CodexThreadForkResult;
  parentThreadId: string;
  workingDirectory: string;
  boundary: CodexReplyForkBoundary;
  isRegistered: boolean;
}): Promise<CodexThreadForkResult> => {
  const childThreadId = response.thread.id;
  if (
    childThreadId === parentThreadId ||
    isRegistered ||
    response.thread.forkedFromId !== parentThreadId
  ) {
    throw new Error(
      `Codex did not return a new child of '${parentThreadId}'. Inspect session '${childThreadId}' before retrying.`,
    );
  }
  let childHistory: CodexThreadHistoryReadResponse | undefined;
  try {
    childHistory = await threadInventory.readThreadHistory(client, {
      externalSessionId: childThreadId,
      workingDirectory,
    });
    assertCodexReplyForkPrefix(childHistory, parentThreadId, boundary);
    return { ...response, thread: childHistory.thread };
  } catch (cause) {
    const cleanupFailures: unknown[] = [];
    for (const turn of childHistory?.thread.turns ?? response.thread.turns) {
      if (turn.status !== "inProgress") continue;
      try {
        await client.turnInterrupt({ threadId: childThreadId, turnId: turn.id });
      } catch (cleanupCause) {
        cleanupFailures.push(cleanupCause);
      }
    }
    if (cleanupFailures.length === 0) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    const cleanupMessage = cleanupFailures
      .map((cleanupCause) =>
        cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause),
      )
      .join("; ");
    throw new AggregateError(
      [cause, ...cleanupFailures],
      `${message} Could not stop work in fork '${childThreadId}': ${cleanupMessage}`,
      { cause },
    );
  }
};

const assertCodexReplyForkPrefix = (
  child: CodexThreadHistoryReadResponse,
  parentThreadId: string,
  boundary: CodexReplyForkBoundary,
): void => {
  const { thread } = child;
  if (
    thread.forkedFromId !== parentThreadId ||
    thread.parentThreadId ||
    codexSubAgentSourceMetadata(thread.source)
  ) {
    throw new Error(
      "Codex returned a child with another source. Inspect the fork before retrying.",
    );
  }
  if (thread.status.type !== "idle" || thread.turns.some((turn) => turn.status === "inProgress")) {
    throw new Error("Codex started work in the fork. Inspect the fork before retrying.");
  }
  const hasExactPrefix =
    thread.turns.length === boundary.turns.length &&
    thread.turns.every((turn, index) => {
      const sourceTurn = boundary.turns[index];
      return (
        sourceTurn?.id === turn.id &&
        sourceTurn.status === turn.status &&
        sourceTurn.items.length === turn.items.length &&
        turn.items.every((item, itemIndex) => {
          const sourceItem = sourceTurn.items[itemIndex];
          return (
            sourceItem?.id === item.id &&
            sourceItem.type === item.type &&
            (item.type !== "agentMessage" ||
              (sourceItem.type === "agentMessage" && sourceItem.text === item.text))
          );
        })
      );
    });
  if (!hasExactPrefix) {
    throw new Error(
      `Codex did not fork through turn '${boundary.lastTurnId}' exactly. Reload the source session before retrying.`,
    );
  }
};
