import type { Event, OpencodeClient, Part } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import {
  extractMessageTotalTokens,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "./message-normalizers";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";
import { normalizeTodoList } from "./todo-normalizers";
import type { SessionInput, SessionRecord } from "./types";

const readStringProp = (payload: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

const normalizePartDeltaField = (field: string): string => {
  if (
    field === "reasoning_content" ||
    field === "reasoning_details" ||
    field === "reasoningContent" ||
    field === "reasoningDetails"
  ) {
    return "text";
  }
  return field;
};

const applyDeltaToPart = (part: Part, field: string, delta: string): Part | null => {
  const normalizedField = normalizePartDeltaField(field);
  const partRecord = part as Record<string, unknown>;
  const existing = partRecord[normalizedField];
  if (existing !== undefined && typeof existing !== "string") {
    return null;
  }

  return {
    ...partRecord,
    [normalizedField]: `${typeof existing === "string" ? existing : ""}${delta}`,
  } as Part;
};

const isRelevantEvent = (externalSessionId: string, event: Event): boolean => {
  const properties = event.properties as Record<string, unknown>;
  const directSessionId = readStringProp(properties, [
    "sessionID",
    "sessionId",
    "session_id",
    "session",
  ]);
  if (directSessionId) {
    return directSessionId === externalSessionId;
  }

  if ("part" in properties) {
    const part = properties.part as Record<string, unknown> | undefined;
    if (part && typeof part === "object") {
      const partSessionId = readStringProp(part, ["sessionID", "sessionId", "session_id"]);
      if (partSessionId) {
        return partSessionId === externalSessionId;
      }
    }
  }

  if ("info" in properties) {
    const info = properties.info as Record<string, unknown> | undefined;
    if (info && typeof info === "object") {
      const infoSessionId = readStringProp(info, ["sessionID", "sessionId", "session_id"]);
      if (infoSessionId) {
        return infoSessionId === externalSessionId;
      }
    }
  }

  return false;
};

type SubscribeOpencodeEventsInput = {
  context: {
    sessionId: string;
    externalSessionId: string;
    input: SessionInput;
  };
  client: OpencodeClient;
  controller: AbortController;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  getSession: (sessionId: string) => SessionRecord | undefined;
};

export const subscribeOpencodeEvents = async (
  input: SubscribeOpencodeEventsInput,
): Promise<void> => {
  const sse = await input.client.event.subscribe(
    { directory: input.context.input.workingDirectory },
    { signal: input.controller.signal },
  );
  const partsById = new Map<string, Part>();
  const messageRoleById = new Map<string, string>();
  const pendingDeltasByPartId = new Map<string, Array<{ field: string; delta: string }>>();

  for await (const event of sse.stream) {
    if (!isRelevantEvent(input.context.externalSessionId, event)) {
      continue;
    }

    if (event.type === "message.updated") {
      const properties = event.properties as Record<string, unknown>;
      const info = properties.info as Record<string, unknown> | undefined;
      const normalizedParts: Part[] = [];
      let messageId: string | undefined;
      let role: string | undefined;

      if (info && typeof info === "object") {
        messageId = readStringProp(info, ["id", "messageID", "messageId", "message_id"]);
        role = readStringProp(info, ["role"]);
        if (messageId && role) {
          messageRoleById.set(messageId, role);
        }
      }

      const rawParts = Array.isArray(properties.parts)
        ? (properties.parts as Array<unknown>)
        : info && Array.isArray((info as { parts?: unknown }).parts)
          ? (((info as { parts: Array<unknown> }).parts as Array<unknown>) ?? [])
          : [];
      if (messageId && rawParts.length > 0) {
        for (const rawPart of rawParts) {
          if (!rawPart || typeof rawPart !== "object") {
            continue;
          }
          const rawPartRecord = rawPart as Record<string, unknown>;
          const rawPartId = readStringProp(rawPartRecord, ["id"]);
          if (!rawPartId) {
            continue;
          }

          let nextPart = {
            ...(rawPartRecord as Part),
            ...(readStringProp(rawPartRecord, ["sessionID", "sessionId", "session_id"])
              ? {}
              : { sessionID: input.context.externalSessionId }),
            ...(readStringProp(rawPartRecord, ["messageID", "messageId", "message_id"])
              ? {}
              : { messageID: messageId }),
          } as Part;

          const pendingDeltas = pendingDeltasByPartId.get(rawPartId);
          if (pendingDeltas && pendingDeltas.length > 0) {
            for (const pending of pendingDeltas) {
              const updated = applyDeltaToPart(nextPart, pending.field, pending.delta);
              if (updated) {
                nextPart = updated;
              }
            }
            pendingDeltasByPartId.delete(rawPartId);
          }

          partsById.set(rawPartId, nextPart);
          normalizedParts.push(nextPart);
          const mapped = mapPartToAgentStreamPart(nextPart);
          if (mapped) {
            const mappedRole = role ?? messageRoleById.get(mapped.messageId);
            if (mappedRole === "user" && mapped.kind === "text") {
              continue;
            }
            input.emit(input.context.sessionId, {
              type: "assistant_part",
              sessionId: input.context.sessionId,
              timestamp: input.now(),
              part: mapped,
            });
          }
        }
      }

      const completedAt =
        info && typeof info === "object"
          ? ((info as { time?: { completed?: unknown } }).time?.completed ?? null)
          : null;
      const finish =
        info && typeof info === "object" ? readStringProp(info, ["finish"]) : undefined;
      if (
        messageId &&
        role === "assistant" &&
        normalizedParts.length > 0 &&
        (typeof completedAt === "number" || finish === "stop")
      ) {
        const text = readTextFromParts(normalizedParts);
        const visible = sanitizeAssistantMessage(text);
        const totalTokens = extractMessageTotalTokens(info, normalizedParts);
        if (visible.length > 0) {
          const session = input.getSession(input.context.sessionId);
          const emitted = session?.emittedAssistantMessageIds;
          if (!emitted?.has(messageId)) {
            input.emit(input.context.sessionId, {
              type: "assistant_message",
              sessionId: input.context.sessionId,
              timestamp: input.now(),
              message: visible,
              ...(typeof totalTokens === "number" ? { totalTokens } : {}),
            });
            emitted?.add(messageId);
          }
        }
      }
    } else if (event.type === "message.part.delta") {
      const deltaEvent = event.properties as Record<string, unknown>;
      const partId = readStringProp(deltaEvent, ["partID", "partId", "part_id"]) ?? "";
      const messageId = readStringProp(deltaEvent, ["messageID", "messageId", "message_id"]);
      const field = readStringProp(deltaEvent, ["field"]) ?? "";
      const delta = typeof deltaEvent.delta === "string" ? deltaEvent.delta : "";
      const knownPart = partId ? partsById.get(partId) : undefined;

      if (knownPart && field.length > 0) {
        const updatedPart = applyDeltaToPart(knownPart, field, delta);
        if (updatedPart) {
          partsById.set(partId, updatedPart);
          const mapped = mapPartToAgentStreamPart(updatedPart);
          if (mapped) {
            const mappedRole = messageRoleById.get(mapped.messageId);
            if (mappedRole === "user" && mapped.kind === "text") {
              continue;
            }
            input.emit(input.context.sessionId, {
              type: "assistant_part",
              sessionId: input.context.sessionId,
              timestamp: input.now(),
              part: mapped,
            });
            continue;
          }
        }
      }

      if (partId && field.length > 0) {
        const pending = pendingDeltasByPartId.get(partId) ?? [];
        pending.push({ field, delta });
        pendingDeltasByPartId.set(partId, pending);
        continue;
      }

      if (delta.length > 0) {
        if (messageId) {
          const deltaRole = messageRoleById.get(messageId);
          if (deltaRole === "user") {
            continue;
          }
        }
        input.emit(input.context.sessionId, {
          type: "assistant_delta",
          sessionId: input.context.sessionId,
          timestamp: input.now(),
          delta,
        });
      }
    } else if (event.type === "message.part.updated") {
      const rawPart = (event.properties as { part?: unknown }).part;
      if (!rawPart || typeof rawPart !== "object") {
        continue;
      }
      let nextPart = rawPart as Part;
      const pendingDeltas = pendingDeltasByPartId.get(nextPart.id);
      if (pendingDeltas && pendingDeltas.length > 0) {
        for (const pending of pendingDeltas) {
          const updated = applyDeltaToPart(nextPart, pending.field, pending.delta);
          if (updated) {
            nextPart = updated;
          }
        }
        pendingDeltasByPartId.delete(nextPart.id);
      }
      partsById.set(nextPart.id, nextPart);
      const mapped = mapPartToAgentStreamPart(nextPart);
      if (mapped) {
        const mappedRole = messageRoleById.get(mapped.messageId);
        if (mappedRole === "user" && mapped.kind === "text") {
          continue;
        }
        input.emit(input.context.sessionId, {
          type: "assistant_part",
          sessionId: input.context.sessionId,
          timestamp: input.now(),
          part: mapped,
        });
      }
    } else if (event.type === "message.part.removed") {
      const removedPartId = readStringProp(event.properties as Record<string, unknown>, [
        "partID",
        "partId",
        "part_id",
      ]);
      if (removedPartId) {
        partsById.delete(removedPartId);
        pendingDeltasByPartId.delete(removedPartId);
      }
    } else if (event.type === "session.status") {
      const status = event.properties.status;
      if (status.type === "busy" || status.type === "idle") {
        input.emit(input.context.sessionId, {
          type: "session_status",
          sessionId: input.context.sessionId,
          timestamp: input.now(),
          status: { type: status.type },
        });
      } else {
        input.emit(input.context.sessionId, {
          type: "session_status",
          sessionId: input.context.sessionId,
          timestamp: input.now(),
          status: {
            type: "retry",
            attempt: status.attempt,
            message: status.message,
            nextEpochMs: status.next,
          },
        });
      }
    } else if (event.type === "permission.asked") {
      input.emit(input.context.sessionId, {
        type: "permission_required",
        sessionId: input.context.sessionId,
        timestamp: input.now(),
        requestId: event.properties.id,
        permission: event.properties.permission,
        patterns: event.properties.patterns,
        metadata: event.properties.metadata,
      });
    } else if (event.type === "question.asked") {
      const questions = event.properties.questions as Array<{
        header: string;
        question: string;
        options: Array<{ label: string; description: string }>;
        multiple?: boolean;
        custom?: boolean;
      }>;
      input.emit(input.context.sessionId, {
        type: "question_required",
        sessionId: input.context.sessionId,
        timestamp: input.now(),
        requestId: event.properties.id,
        questions: questions.map((question) => ({
          header: question.header,
          question: question.question,
          options: question.options,
          ...(question.multiple !== undefined ? { multiple: question.multiple } : {}),
          ...(question.custom !== undefined ? { custom: question.custom } : {}),
        })),
      });
    } else if (event.type === "session.error") {
      const maybeMessage = event.properties.error?.data?.message;
      input.emit(input.context.sessionId, {
        type: "session_error",
        sessionId: input.context.sessionId,
        timestamp: input.now(),
        message: typeof maybeMessage === "string" ? maybeMessage : "Unknown session error",
      });
    } else if (event.type === "session.idle") {
      input.emit(input.context.sessionId, {
        type: "session_idle",
        sessionId: input.context.sessionId,
        timestamp: input.now(),
      });
    } else if (event.type === "todo.updated") {
      const props = event.properties as Record<string, unknown>;
      const todos = normalizeTodoList(props.todos);
      input.emit(input.context.sessionId, {
        type: "session_todos_updated",
        sessionId: input.context.sessionId,
        timestamp: input.now(),
        todos,
      });
    }
  }
};
