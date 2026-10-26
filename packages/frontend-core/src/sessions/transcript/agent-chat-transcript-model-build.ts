import { startTransition } from "react";
import {
  findFirstChangedSessionMessageIndex,
  getSessionMessageAt,
  getSessionMessageCount,
} from "../agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";
import {
  type AgentChatTranscriptModel,
  type AgentChatTranscriptModelPrefixMode,
  createAgentChatTranscriptModelBuilder,
  isVisibleTranscriptMessage,
  reuseUnchangedTranscriptRows,
  updateAgentChatTranscriptModelFromPrefix,
} from "./agent-chat-transcript-model";
import type { TranscriptModelCacheEntry } from "./agent-chat-transcript-model-cache";

const CHUNK_BUDGET_MS = 6;
const MAX_CHUNK_MESSAGES = 250;
export const MAX_SYNC_MESSAGES = 100;

type UpdatePlan = {
  mode: AgentChatTranscriptModelPrefixMode;
  startIndex: number;
};

/**
 * The model of `session` from `previous` when at most `MAX_SYNC_MESSAGES` messages at the end
 * changed. It costs about as much as the changed messages. Null when the change needs a full build.
 */
export const updateTranscriptModelAtOnce = ({
  session,
  showThinkingMessages,
  previous,
}: {
  session: AgentChatTranscriptSession;
  showThinkingMessages: boolean;
  previous: TranscriptModelCacheEntry | null;
}): AgentChatTranscriptModel | null => {
  const plan = planUpdate(previous, session, showThinkingMessages);
  if (!previous || !plan) {
    return null;
  }
  return updateAgentChatTranscriptModelFromPrefix({
    session,
    showThinkingMessages,
    previousTranscriptModel: previous,
    startMessageIndex: plan.startIndex,
    mode: plan.mode,
  });
};

/** Builds the full model in short slices, so input runs between them. Returns the stop. */
export const buildTranscriptModelInChunks = ({
  session,
  showThinkingMessages,
  previous,
  onComplete,
}: {
  session: AgentChatTranscriptSession;
  showThinkingMessages: boolean;
  previous: TranscriptModelCacheEntry | null;
  onComplete: (model: AgentChatTranscriptModel) => void;
}): (() => void) => {
  const builder = createAgentChatTranscriptModelBuilder(session, { showThinkingMessages });
  let stopped = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const scheduleChunk = (): void => {
    timer = globalThis.setTimeout(() => {
      timer = null;
      if (stopped) {
        return;
      }

      const startedAt = now();
      let processed = 0;
      while (
        !builder.isDone() &&
        processed < MAX_CHUNK_MESSAGES &&
        now() - startedAt < CHUNK_BUDGET_MS
      ) {
        processed += builder.step(1);
      }

      if (!builder.isDone()) {
        scheduleChunk();
        return;
      }

      const model = reuseUnchangedTranscriptRows(previous, builder.complete());
      startTransition(() => onComplete(model));
    }, 0);
  };
  scheduleChunk();

  return () => {
    stopped = true;
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
  };
};

/**
 * An append adds rows after the previous ones. A replace cuts the previous rows at the row of the
 * first changed message and builds the rows of the messages from there, as when a tool call, a
 * user message, or the streamed text near the end changes. The first changed message must keep its
 * id and its row, so the cut falls at its place.
 */
const planUpdate = (
  previous: TranscriptModelCacheEntry | null,
  session: AgentChatTranscriptSession,
  showThinkingMessages: boolean,
): UpdatePlan | null => {
  if (!previous) {
    return null;
  }

  const startIndex = findFirstChangedSessionMessageIndex(previous.session.messages, session);
  if (startIndex < 0) {
    return null;
  }

  const previousCount = previous.session.messages.items.length;
  const count = getSessionMessageCount(session);
  if (count < previousCount || count - startIndex > MAX_SYNC_MESSAGES) {
    return null;
  }
  if (startIndex >= previousCount) {
    return { mode: "append", startIndex };
  }

  const previousMessage = previous.session.messages.items[startIndex];
  const message = getSessionMessageAt(session, startIndex);
  if (
    !previousMessage ||
    !message ||
    previousMessage.id !== message.id ||
    !isVisibleTranscriptMessage(message, showThinkingMessages) ||
    !hasSamePrefix(previous, session, startIndex) ||
    hasMessageInPrefix(previous.session.messages, message.id, startIndex)
  ) {
    return null;
  }
  return { mode: "replace-tail", startIndex };
};

const hasSamePrefix = (
  previous: TranscriptModelCacheEntry,
  session: AgentChatTranscriptSession,
  endIndex: number,
): boolean => {
  for (let index = 0; index < endIndex; index += 1) {
    if (previous.session.messages.items[index] !== getSessionMessageAt(session, index)) {
      return false;
    }
  }
  return true;
};

const hasMessageInPrefix = (
  messages: AgentChatTranscriptSession["messages"],
  messageId: string,
  endIndex: number,
): boolean => {
  for (let index = 0; index < endIndex; index += 1) {
    if (messages.items[index]?.id === messageId) {
      return true;
    }
  }
  return false;
};

// Millisecond resolution is enough for the chunk budget, and every runtime supplies it.
const now = (): number => Date.now();
