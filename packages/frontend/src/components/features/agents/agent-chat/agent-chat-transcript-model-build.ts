import { startTransition } from "react";
import {
  findFirstChangedSessionMessageIndex,
  getSessionMessageAt,
  getSessionMessageCount,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentChatTranscriptSession } from "./agent-chat.types";
import {
  type AgentChatTranscriptModel,
  type AgentChatTranscriptModelPrefixMode,
  createAgentChatTranscriptModelBuilder,
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
 * Finish small tail edits at once. Chunk full builds so input can run.
 * Return a function that stops queued work.
 */
export const buildTranscriptModel = ({
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
  const plan = planUpdate(previous, session);
  if (previous && plan) {
    const model = updateAgentChatTranscriptModelFromPrefix({
      session,
      showThinkingMessages,
      previousTranscriptModel: previous,
      startMessageIndex: plan.startIndex,
      mode: plan.mode,
    });
    if (model) {
      onComplete(model);
      return () => {};
    }
  }

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

      const model = builder.complete();
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

const planUpdate = (
  previous: TranscriptModelCacheEntry | null,
  session: AgentChatTranscriptSession,
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
  const changedCount = count - startIndex;
  const previousMessage = previous.session.messages.items[startIndex];
  const message = session.messages.items[startIndex];
  const isAppend = startIndex >= previousCount;
  const isTailEdit = Boolean(
    previousMessage &&
    message &&
    startIndex === previousCount - 1 &&
    previousMessage.id === message.id &&
    previousMessage.role === "assistant" &&
    message.role === "assistant",
  );

  if (
    isTailEdit &&
    (!hasSamePrefix(previous, session, startIndex) ||
      (message && hasMessageInPrefix(previous.session.messages, message.id, startIndex)))
  ) {
    return null;
  }

  if (
    count < previousCount ||
    changedCount < 0 ||
    changedCount > MAX_SYNC_MESSAGES ||
    (!isAppend && !isTailEdit)
  ) {
    return null;
  }

  return {
    mode: isAppend ? "append" : "replace-tail",
    startIndex,
  };
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

const now = (): number => {
  return globalThis.performance?.now !== undefined ? globalThis.performance.now() : Date.now();
};
