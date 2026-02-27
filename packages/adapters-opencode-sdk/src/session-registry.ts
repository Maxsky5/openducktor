import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent, AgentSessionSummary } from "@openducktor/core";
import { subscribeOpencodeEvents } from "./event-stream";
import type { OpencodeEventLogger, SessionInput, SessionRecord } from "./types";

export const hasSession = (sessions: Map<string, SessionRecord>, sessionId: string): boolean => {
  return sessions.has(sessionId);
};

export const requireSession = (
  sessions: Map<string, SessionRecord>,
  sessionId: string,
): SessionRecord => {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return session;
};

export const registerSession = (input: {
  sessions: Map<string, SessionRecord>;
  sessionId: string;
  externalSessionId: string;
  sessionInput: SessionInput;
  client: OpencodeClient;
  startedAt: string;
  startedMessage: string;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  logEvent?: OpencodeEventLogger;
}): AgentSessionSummary => {
  const controller = new AbortController();
  const summary: AgentSessionSummary = {
    sessionId: input.sessionId,
    externalSessionId: input.externalSessionId,
    role: input.sessionInput.role,
    scenario: input.sessionInput.scenario,
    startedAt: input.startedAt,
    status: "running",
  };

  const streamDone = subscribeOpencodeEvents({
    context: {
      sessionId: input.sessionId,
      externalSessionId: input.externalSessionId,
      input: input.sessionInput,
    },
    client: input.client,
    controller,
    now: input.now,
    emit: input.emit,
    getSession: (sessionId) => input.sessions.get(sessionId),
    ...(input.logEvent ? { logEvent: input.logEvent } : {}),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Event stream failed";
    input.emit(input.sessionId, {
      type: "session_error",
      sessionId: input.sessionId,
      timestamp: input.now(),
      message,
    });
  });

  input.sessions.set(input.sessionId, {
    summary,
    input: input.sessionInput,
    client: input.client,
    externalSessionId: input.externalSessionId,
    streamAbortController: controller,
    streamDone,
    emittedAssistantMessageIds: new Set<string>(),
  });

  input.emit(input.sessionId, {
    type: "session_started",
    sessionId: input.sessionId,
    timestamp: input.now(),
    message: input.startedMessage,
  });

  return summary;
};

export const clearWorkflowToolCacheForDirectory = (
  sessions: Map<string, SessionRecord>,
  workingDirectory: string,
): void => {
  for (const session of sessions.values()) {
    if (session.input.workingDirectory === workingDirectory) {
      delete session.workflowToolSelectionCache;
      delete session.workflowToolSelectionCachedAt;
    }
  }
};

export const stopSessionRuntime = async (session: SessionRecord): Promise<void> => {
  try {
    await session.client.session.abort({
      directory: session.input.workingDirectory,
      sessionID: session.externalSessionId,
    });
  } catch (abortError) {
    void abortError;
  }

  session.streamAbortController.abort();
  await session.streamDone.catch(() => undefined);
};
