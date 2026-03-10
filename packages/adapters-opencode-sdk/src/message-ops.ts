import type {
  AgentEvent,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentStreamPart,
  ReplyPermissionInput,
  ReplyQuestionInput,
  SendAgentUserMessageInput,
} from "@openducktor/core";
import { unwrapData } from "./data-utils";
import {
  extractMessageTotalTokens,
  readMessageModelSelection,
  readTextFromMessageInfo,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "./message-normalizers";
import { normalizeModelInput, resolveAssistantResponseMessageId } from "./payload-mappers";
import { toIsoFromEpoch } from "./session-runtime-utils";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";
import { normalizeTodoList } from "./todo-normalizers";
import type { ClientFactory, SessionRecord } from "./types";

type TodoRequestFailure = {
  message: string;
  status?: number;
  statusText?: string;
  code?: string;
};

const readUnknownProp = (value: unknown, key: string): unknown => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
};

const readStringProp = (value: unknown, key: string): string | undefined => {
  const candidate = readUnknownProp(value, key);
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
};

const readNumberProp = (value: unknown, key: string): number | undefined => {
  const candidate = readUnknownProp(value, key);
  return typeof candidate === "number" ? candidate : undefined;
};

const normalizeTodoRequestFailure = (
  error: unknown,
  response?: { status?: unknown; statusText?: unknown },
): TodoRequestFailure => {
  const errorMessage =
    (error instanceof Error && error.message.trim().length > 0 ? error.message : undefined) ??
    readStringProp(error, "message") ??
    readStringProp(readUnknownProp(error, "data"), "message") ??
    "OpenCode request failed: load session todos";
  const errorStatus = readNumberProp(error, "status");
  const errorStatusText = readStringProp(error, "statusText");
  const errorCodeRaw = readUnknownProp(error, "code");
  const errorCode =
    typeof errorCodeRaw === "string" || typeof errorCodeRaw === "number"
      ? String(errorCodeRaw)
      : undefined;

  return {
    message: errorMessage,
    ...(typeof errorStatus === "number"
      ? { status: errorStatus }
      : typeof response?.status === "number"
        ? { status: response.status }
        : {}),
    ...(errorStatusText
      ? { statusText: errorStatusText }
      : typeof response?.statusText === "string" && response.statusText.trim().length > 0
        ? { statusText: response.statusText }
        : {}),
    ...(errorCode ? { code: errorCode } : {}),
  };
};

export const loadSessionHistory = async (
  createClient: ClientFactory,
  now: () => string,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
    externalSessionId: string;
    limit?: number;
  },
): Promise<AgentSessionHistoryMessage[]> => {
  const client = createClient({
    runtimeEndpoint: input.runtimeEndpoint,
    workingDirectory: input.workingDirectory,
  });
  const response = await client.session.messages({
    sessionID: input.externalSessionId,
    directory: input.workingDirectory,
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
  });
  const data = unwrapData(response, "load session messages");
  const mapped = data.map((entry) => {
    const rawTextFromParts = readTextFromParts(entry.parts);
    const rawText =
      rawTextFromParts.length > 0 ? rawTextFromParts : readTextFromMessageInfo(entry.info);
    const text = entry.info.role === "assistant" ? sanitizeAssistantMessage(rawText) : rawText;
    const totalTokens = extractMessageTotalTokens(entry.info, entry.parts);
    const parts = entry.parts
      .map(mapPartToAgentStreamPart)
      .filter((part): part is AgentStreamPart => part !== null && part.kind !== "text");

    return {
      messageId: entry.info.id,
      role: entry.info.role,
      timestamp: toIsoFromEpoch(entry.info.time.created, now),
      text,
      ...(typeof totalTokens === "number" ? { totalTokens } : {}),
      ...(() => {
        const model = readMessageModelSelection(entry.info);
        return model ? { model } : {};
      })(),
      parts,
    };
  });

  mapped.sort((a, b) => {
    const aTime = Date.parse(a.timestamp);
    const bTime = Date.parse(b.timestamp);
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
      return 0;
    }
    return aTime - bTime;
  });

  return mapped;
};

export const loadSessionTodos = async (
  createClient: ClientFactory,
  input: {
    runtimeEndpoint: string;
    workingDirectory: string;
    externalSessionId: string;
  },
): Promise<AgentSessionTodoItem[]> => {
  try {
    const trimmedWorkingDirectory = input.workingDirectory.trim();
    const client = createClient({
      runtimeEndpoint: input.runtimeEndpoint,
      workingDirectory: input.workingDirectory,
    });
    const response = await client.session.todo({
      sessionID: input.externalSessionId,
      ...(trimmedWorkingDirectory.length > 0 ? { directory: trimmedWorkingDirectory } : {}),
    });
    if (response.data === undefined || response.data === null) {
      const normalizedError = normalizeTodoRequestFailure(
        response.error,
        (response as { response?: { status?: unknown; statusText?: unknown } }).response,
      );
      console.warn("loadSessionTodos: request failed", normalizedError);
      return [];
    }
    const payload = response.data;
    return normalizeTodoList(payload);
  } catch (error) {
    const normalizedError = normalizeTodoRequestFailure(error);
    console.warn("loadSessionTodos: request failed", normalizedError);
    return [];
  }
};

export const sendUserMessage = async (input: {
  session: SessionRecord;
  request: SendAgentUserMessageInput;
  tools: Record<string, boolean>;
  now: () => string;
  emit: (event: AgentEvent) => void;
}): Promise<void> => {
  const model = input.request.model ?? input.session.input.model;
  const modelInput = normalizeModelInput(model);

  const response = await input.session.client.session.prompt({
    sessionID: input.session.externalSessionId,
    directory: input.session.input.workingDirectory,
    ...(input.session.input.systemPrompt.trim().length > 0
      ? { system: input.session.input.systemPrompt }
      : {}),
    ...(modelInput.model ? { model: modelInput.model } : {}),
    ...(modelInput.variant ? { variant: modelInput.variant } : {}),
    ...(modelInput.agent ? { agent: modelInput.agent } : {}),
    tools: input.tools,
    parts: [{ type: "text", text: input.request.content }],
  });
  const responseData = unwrapData(response, "prompt session");
  const responseMessageId = resolveAssistantResponseMessageId(responseData);

  for (const responsePart of responseData.parts) {
    const mappedPart = mapPartToAgentStreamPart(responsePart);
    if (!mappedPart) {
      continue;
    }
    input.emit({
      type: "assistant_part",
      sessionId: input.session.summary.sessionId,
      timestamp: input.now(),
      part: mappedPart,
    });
  }

  const assistantMessage = sanitizeAssistantMessage(readTextFromParts(responseData.parts));
  const totalTokens = extractMessageTotalTokens(
    (responseData as { info?: unknown }).info,
    responseData.parts,
  );
  const assistantModel = readMessageModelSelection((responseData as { info?: unknown }).info);
  if (assistantMessage.length > 0) {
    input.emit({
      type: "assistant_message",
      sessionId: input.session.summary.sessionId,
      timestamp: input.now(),
      message: assistantMessage,
      ...(typeof totalTokens === "number" ? { totalTokens } : {}),
      ...(assistantModel ? { model: assistantModel } : {}),
    });
    if (responseMessageId) {
      input.session.emittedAssistantMessageIds.add(responseMessageId);
    }
  }

  input.emit({
    type: "session_idle",
    sessionId: input.session.summary.sessionId,
    timestamp: input.now(),
  });
};

export const replyPermission = async (
  session: SessionRecord,
  input: ReplyPermissionInput,
): Promise<void> => {
  await session.client.permission.reply({
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    reply: input.reply,
    ...(input.message ? { message: input.message } : {}),
  });
};

export const replyQuestion = async (
  session: SessionRecord,
  input: ReplyQuestionInput,
): Promise<void> => {
  await session.client.question.reply({
    directory: session.input.workingDirectory,
    requestID: input.requestId,
    answers: input.answers,
  });
};
