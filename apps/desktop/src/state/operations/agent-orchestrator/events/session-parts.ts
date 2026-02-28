import type { AgentSessionState } from "@/types/agent-orchestrator";
import { sanitizeStreamingText, upsertMessage } from "../support/utils";
import type {
  SessionEvent,
  SessionEventContext,
  SessionPart,
  SessionPartEvent,
} from "./session-event-types";
import { createPrePartTodoSettlement, toPartStreamKey } from "./session-helpers";
import { handleToolPart } from "./session-tool-parts";

type PrepareCurrent = (current: AgentSessionState) => AgentSessionState;

export const handleAssistantDelta = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_delta" }>,
): void => {
  if (context.draftSourceBySessionRef.current[context.sessionId] === "part") {
    return;
  }
  context.draftSourceBySessionRef.current[context.sessionId] = "delta";
  const nextRaw = `${context.draftRawBySessionRef.current[context.sessionId] ?? ""}${event.delta}`;
  context.draftRawBySessionRef.current[context.sessionId] = nextRaw;
  context.updateSession(
    context.sessionId,
    (current) => ({
      ...current,
      status: "running",
      draftAssistantText: sanitizeStreamingText(nextRaw),
    }),
    { persist: false },
  );
};

const handleTextPart = (
  context: SessionEventContext,
  part: Extract<SessionPart, { kind: "text" }>,
  prepareCurrent: PrepareCurrent,
): void => {
  if (part.synthetic) {
    return;
  }
  context.draftSourceBySessionRef.current[context.sessionId] = "part";
  context.draftRawBySessionRef.current[context.sessionId] = part.text;
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      return {
        ...prepared,
        status: "running",
        draftAssistantText: sanitizeStreamingText(part.text),
      };
    },
    { persist: false },
  );
};

const handleReasoningPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "reasoning" }>,
  streamMessageKey: string,
  prepareCurrent: PrepareCurrent,
): void => {
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      const messageId = `thinking:${streamMessageKey}`;
      const existingMessage = prepared.messages.find((entry) => entry.id === messageId);
      const nextContent =
        part.text.trim().length > 0 ? part.text : (existingMessage?.content ?? "");
      if (nextContent.trim().length === 0) {
        return {
          ...prepared,
          status: "running",
        };
      }

      return {
        ...prepared,
        status: "running",
        messages: upsertMessage(prepared.messages, {
          id: messageId,
          role: "thinking",
          content: nextContent,
          timestamp: event.timestamp,
          meta: {
            kind: "reasoning",
            partId: part.partId,
            completed: part.completed,
          },
        }),
      };
    },
    { persist: false },
  );
};

const handleSubtaskPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
  part: Extract<SessionPart, { kind: "subtask" }>,
  streamMessageKey: string,
  prepareCurrent: PrepareCurrent,
): void => {
  context.updateSession(
    context.sessionId,
    (current) => {
      const prepared = prepareCurrent(current);
      return {
        ...prepared,
        status: "running",
        messages: upsertMessage(prepared.messages, {
          id: `subtask:${streamMessageKey}`,
          role: "system",
          content: `Subtask (${part.agent}): ${part.description}`,
          timestamp: event.timestamp,
          meta: {
            kind: "subtask",
            partId: part.partId,
            agent: part.agent,
            prompt: part.prompt,
            description: part.description,
          },
        }),
      };
    },
    { persist: false },
  );
};

export const handleAssistantPart = (
  context: SessionEventContext,
  event: SessionPartEvent,
): void => {
  const part = event.part;
  const streamMessageKey = toPartStreamKey(part);
  const prepareCurrent = createPrePartTodoSettlement(part, event.timestamp);

  switch (part.kind) {
    case "text":
      handleTextPart(context, part, prepareCurrent);
      return;
    case "reasoning":
      handleReasoningPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "tool":
      handleToolPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "subtask":
      handleSubtaskPart(context, event, part, streamMessageKey, prepareCurrent);
      return;
    case "step":
      return;
  }
};
