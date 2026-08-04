import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type {
  ClaudeAgentSdkEvent,
  ClaudeAgentSdkEventEmitter,
  ClaudeSession,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { contextUsageFromClaudeControlResponse } from "./claude-agent-sdk-usage";
import { withTimeout } from "./claude-agent-sdk-utils";

export const CLAUDE_CONTEXT_USAGE_TIMEOUT_MS = 30_000;
const CONTEXT_USAGE_REFRESH_MIN_INTERVAL_MS = process.env.NODE_ENV === "test" ? 0 : 250;

type ContextUsageRefreshState = {
  inFlight: boolean;
  promise?: Promise<void>;
  queuedTimestamp?: string;
};

type EmitContextUsageInput = {
  externalSessionId: string;
  query: Pick<ClaudeSession["query"], "getContextUsage">;
  timestamp: string;
  emit: (event: ClaudeAgentSdkEvent) => void;
};

type LiveContextUsageRefreshInput = {
  emit: ClaudeAgentSdkEventEmitter;
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"];
  session: ClaudeSession;
  timestamp: string;
};

const refreshStates = new WeakMap<ClaudeSession, ContextUsageRefreshState>();

const waitBeforeNextContextUsageRefresh = async (): Promise<void> => {
  if (CONTEXT_USAGE_REFRESH_MIN_INTERVAL_MS <= 0) {
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, CONTEXT_USAGE_REFRESH_MIN_INTERVAL_MS));
};

export const readClaudeContextUsageFromQuery = async (
  sdkQuery: Pick<ClaudeSession["query"], "getContextUsage">,
): Promise<{ usedTokens: number; maxTokens: number } | null> => {
  const contextUsage = contextUsageFromClaudeControlResponse(
    await withTimeout(
      sdkQuery.getContextUsage(),
      CLAUDE_CONTEXT_USAGE_TIMEOUT_MS,
      "Claude Agent SDK context usage read timed out.",
    ),
  );
  if (contextUsage.usedTokens === undefined || contextUsage.maxTokens === undefined) {
    return null;
  }
  return {
    usedTokens: contextUsage.usedTokens,
    maxTokens: contextUsage.maxTokens,
  };
};

const emitClaudeContextUsageFromQuery = async ({
  emit,
  externalSessionId,
  query: sdkQuery,
  timestamp,
}: EmitContextUsageInput): Promise<void> => {
  const contextUsage = await readClaudeContextUsageFromQuery(sdkQuery);
  if (!contextUsage) {
    return;
  }
  emit({
    type: "session_context_updated",
    externalSessionId,
    timestamp,
    totalTokens: contextUsage.usedTokens,
    contextWindow: contextUsage.maxTokens,
  });
};

const emitContextRefreshError = ({
  emit,
  error,
  session,
  timestamp,
}: {
  emit: ClaudeAgentSdkEventEmitter;
  error: unknown;
  session: ClaudeSession;
  timestamp: string;
}): void => {
  const message = error instanceof Error ? error.message : String(error);
  emit(session, {
    type: "session_context_error",
    externalSessionId: session.externalSessionId,
    timestamp,
    message,
  });
  console.warn(
    `Failed to refresh Claude context usage for session '${session.externalSessionId}': ${message}`,
  );
};

const refreshClaudeLiveContextUsage = async ({
  emit,
  session,
  timestamp,
}: Pick<LiveContextUsageRefreshInput, "emit" | "session" | "timestamp">): Promise<void> => {
  await emitClaudeContextUsageFromQuery({
    externalSessionId: session.externalSessionId,
    query: session.query,
    timestamp,
    emit: (event) => emit(session, event),
  });
};

const reportContextRefreshFailure = (
  cause: unknown,
  session: ClaudeSession,
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"],
): void => {
  Effect.runFork(
    onBackgroundFailure(
      new HostOperationError({
        operation: "claudeRuntime.refreshLiveContextUsage",
        message: `Failed to publish Claude context refresh failure for session '${session.externalSessionId}': ${errorMessage(cause)}`,
        cause,
        details: { externalSessionId: session.externalSessionId },
      }),
    ),
  );
};

export const scheduleClaudeLiveContextUsageRefresh = ({
  emit,
  onBackgroundFailure,
  session,
  timestamp,
}: LiveContextUsageRefreshInput): void => {
  const existing = refreshStates.get(session);
  if (existing?.inFlight) {
    existing.queuedTimestamp = timestamp;
    return;
  }

  const state: ContextUsageRefreshState = { inFlight: true };
  refreshStates.set(session, state);

  const refreshPromise = (async () => {
    let nextTimestamp: string | undefined = timestamp;
    while (nextTimestamp !== undefined) {
      const currentTimestamp = nextTimestamp;
      nextTimestamp = undefined;
      try {
        await refreshClaudeLiveContextUsage({ emit, session, timestamp: currentTimestamp });
      } catch (error) {
        emitContextRefreshError({ emit, error, session, timestamp: currentTimestamp });
      }
      if (state.queuedTimestamp !== undefined) {
        nextTimestamp = state.queuedTimestamp;
        delete state.queuedTimestamp;
        await waitBeforeNextContextUsageRefresh();
      }
    }
  })();
  state.promise = refreshPromise.finally(() => {
    state.inFlight = false;
    refreshStates.delete(session);
  });
  void state.promise.catch((cause) => {
    reportContextRefreshFailure(cause, session, onBackgroundFailure);
  });
};

export const flushClaudeLiveContextUsageRefresh = async (session: ClaudeSession): Promise<void> => {
  await refreshStates.get(session)?.promise;
};

const readStreamEventType = (message: SDKMessage): string | undefined =>
  message.type === "stream_event" &&
  "event" in message &&
  message.event &&
  typeof message.event === "object" &&
  "type" in message.event &&
  typeof message.event.type === "string"
    ? message.event.type
    : undefined;

export const shouldRefreshClaudeContextUsageForMessage = (message: SDKMessage): boolean => {
  if (message.type === "assistant" || message.type === "user") {
    return true;
  }
  if (message.type === "result") {
    return (message as { stop_reason?: unknown }).stop_reason !== "tool_use";
  }
  return readStreamEventType(message) === "message_stop";
};
