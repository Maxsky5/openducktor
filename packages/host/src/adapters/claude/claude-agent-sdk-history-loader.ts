import {
  AGENT_SESSION_SYSTEM_PROMPT_PREFIX,
  type AgentSessionHistoryMessage,
  type LoadAgentSessionHistoryInput,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import {
  isClaudeSessionMissingError,
  loadClaudeHistoryProjectionInput,
  type ClaudeHistoryMessage,
  type ClaudeHistoryReadFailure,
} from "./claude-agent-sdk-history-messages";
import type { ClaudeTranscriptReadOptions } from "./claude-transcript-reader";
import { hasFinalStopStep, type ClaudeLiveUserMessage } from "./claude-agent-sdk-history-support";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { childSessions } from "./claude-agent-sdk-session-children";
import { hasActiveClaudeWork } from "./claude-agent-sdk-session-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { createClaudeTranscriptSubagentReader } from "./claude-transcript-subagents";

export type ClaudeLiveHistoryContext = {
  activeBackgroundTaskIds: () => ReadonlySet<string>;
  hasActiveWork: () => boolean;
  source: "fresh" | "persisted";
  subagentAgentIdsByToolUseId?: ReadonlyMap<string, string>;
  userMessages: readonly ClaudeLiveUserMessage[];
  completedReplyMessageIds?: () => ReadonlySet<string>;
};

/** A resumed or forked session must load its saved transcript. */
export const claudeLiveHistoryContext = (
  session: ClaudeSession,
  externalSessionId = session.externalSessionId,
): ClaudeLiveHistoryContext => {
  const isSubagent = isClaudeSubagentTranscriptTarget(externalSessionId);
  const work = isSubagent ? findClaudeHistoryWork(session, externalSessionId) : session;
  return {
    activeBackgroundTaskIds: () => {
      const ids = new Set<string>();
      const collect = (work: ClaudeEventSession): void => {
        for (const id of work.backgroundToolActiveTaskIds ?? []) ids.add(id);
        for (const id of work.activeBackgroundSubagentTaskIds ?? []) ids.add(id);
        for (const child of childSessions(work)) collect(child);
      };
      const work = isSubagent ? findClaudeHistoryWork(session, externalSessionId) : session;
      if (work) collect(work);
      return ids;
    },
    hasActiveWork: () => hasActiveClaudeWork(session),
    completedReplyMessageIds: () => new Set(session.completedReplyChainIds?.keys()),
    source:
      isSubagent ||
      "externalSessionId" in session.input ||
      "parentExternalSessionId" in session.input
        ? "persisted"
        : "fresh",
    subagentAgentIdsByToolUseId: work?.subagentAgentIdsByToolUseId ?? new Map(),
    get userMessages() {
      return isSubagent ? [] : [...session.acceptedUserMessages];
    },
  };
};

export const finalizeClaudeHistory = (
  input: LoadAgentSessionHistoryInput,
  history: AgentSessionHistoryMessage[],
): AgentSessionHistoryMessage[] => {
  const limitedHistory = history.slice(input.limit ? -input.limit : undefined);
  const systemPromptContext = input.systemPromptContext;
  const systemPrompt = systemPromptContext?.systemPrompt.trim() ?? "";
  if (!systemPromptContext || systemPrompt.length === 0) {
    return limitedHistory;
  }
  return [
    {
      messageId: `claude-system-prompt:${input.externalSessionId}`,
      role: "system",
      timestamp: systemPromptContext.startedAt,
      text: `${AGENT_SESSION_SYSTEM_PROMPT_PREFIX}${systemPrompt}`,
      parts: [],
    },
    ...limitedHistory,
  ];
};

export const loadClaudeHistory = (
  input: LoadAgentSessionHistoryInput,
  now: () => string,
  liveContext?: ClaudeLiveHistoryContext,
  options: ClaudeTranscriptReadOptions = {},
): Effect.Effect<AgentSessionHistoryMessage[], ClaudeHistoryReadFailure> =>
  projectClaudeHistory(input, now, liveContext, loadClaudeHistoryProjectionInput(input, options));

type ClaudeHistorySnapshot = {
  history: AgentSessionHistoryMessage[];
  messages: readonly ClaudeHistoryMessage[];
};

export const loadClaudeHistorySnapshot = (
  input: LoadAgentSessionHistoryInput,
  now: () => string,
  liveContext?: ClaudeLiveHistoryContext,
  options: ClaudeTranscriptReadOptions = {},
): Effect.Effect<ClaudeHistorySnapshot, ClaudeHistoryReadFailure> =>
  Effect.gen(function* () {
    const projectionInput = yield* loadClaudeHistoryProjectionInput(input, options);
    const history = yield* projectClaudeHistory(
      input,
      now,
      liveContext,
      Effect.succeed(projectionInput),
    );
    return { history, messages: projectionInput.messages };
  });

const findClaudeHistoryWork = (
  session: ClaudeEventSession,
  externalSessionId: string,
): ClaudeEventSession | null => {
  if (session.externalSessionId === externalSessionId) return session;
  for (const child of childSessions(session)) {
    const match = findClaudeHistoryWork(child, externalSessionId);
    if (match) return match;
  }
  return null;
};

const projectClaudeHistory = (
  input: LoadAgentSessionHistoryInput,
  now: () => string,
  liveContext: ClaudeLiveHistoryContext | undefined,
  loadProjectionInput: ReturnType<typeof loadClaudeHistoryProjectionInput>,
): Effect.Effect<AgentSessionHistoryMessage[], ClaudeHistoryReadFailure> =>
  Effect.gen(function* () {
    if (liveContext?.source === "fresh" && liveContext.userMessages.length === 0) {
      return finalizeClaudeHistory(input, []);
    }
    const projectionInput = yield* loadProjectionInput.pipe(
      Effect.catch((cause) => {
        // The UI can read history after the first live message but before Claude writes the
        // transcript. In this gap, the fresh session and its live events hold the new messages.
        if (
          liveContext?.source !== "fresh" ||
          !liveContext.hasActiveWork() ||
          !isClaudeSessionMissingError(cause)
        ) {
          return Effect.fail(cause);
        }
        return Effect.succeed(null);
      }),
    );
    const messages = projectionInput?.messages ?? [];
    const subagents = projectionInput
      ? createClaudeTranscriptSubagentReader(projectionInput.source, messages)
      : undefined;
    const isSubagentTranscript = isClaudeSubagentTranscriptTarget(input.externalSessionId);
    const projectionOptions: NonNullable<Parameters<typeof toClaudeHistoryMessages>[3]> = {
      includeNestedEntries: isSubagentTranscript,
      transcriptExternalSessionId: input.externalSessionId,
    };
    if (subagents) {
      projectionOptions.subagentAgentIdsByToolUseId = yield* subagents.correlations(
        liveContext?.subagentAgentIdsByToolUseId,
      );
    }
    projectionOptions.currentBackgroundTaskIds =
      liveContext?.activeBackgroundTaskIds() ?? new Set();
    const history = yield* Effect.try({
      try: () =>
        toClaudeHistoryMessages(messages, now, liveContext?.userMessages ?? [], projectionOptions),
      catch: (cause) => {
        if (cause instanceof HostValidationError) return cause;
        throw cause;
      },
    });
    if (subagents) yield* subagents.reconcile(history);
    if (!isSubagentTranscript) {
      const currentUserIndex = history.findLastIndex((message) => message.role === "user");
      const active = liveContext?.hasActiveWork() ?? false;
      const completed = liveContext?.completedReplyMessageIds?.();
      for (const [index, message] of history.entries()) {
        if (
          message.role === "assistant" &&
          message.text.trim().length > 0 &&
          hasFinalStopStep(message) &&
          (!active || index < currentUserIndex || completed?.has(message.messageId))
        ) {
          message.forkPoint = { messageId: message.messageId };
        }
      }
    }
    return finalizeClaudeHistory(input, history);
  });
