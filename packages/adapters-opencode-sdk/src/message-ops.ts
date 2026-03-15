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
import { toOpenCodeRequestError } from "./request-errors";
import { toIsoFromEpoch } from "./session-runtime-utils";
import { mapPartToAgentStreamPart } from "./stream-part-mapper";
import { normalizeTodoList } from "./todo-normalizers";
import type { ClientFactory, SessionRecord } from "./types";

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
      throw toOpenCodeRequestError(
        "load session todos",
        response.error,
        (response as { response?: { status?: unknown; statusText?: unknown } }).response,
      );
    }
    const payload = response.data;
    return normalizeTodoList(payload);
  } catch (error) {
    throw toOpenCodeRequestError("load session todos", error);
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
  const responseMessageId = resolveAssistantResponseMessageId(responseData);
  if (assistantMessage.length > 0) {
    if (!responseMessageId) {
      throw new Error("Prompt session returned assistant text without a message id.");
    }
    input.emit({
      type: "assistant_message",
      sessionId: input.session.summary.sessionId,
      timestamp: input.now(),
      messageId: responseMessageId,
      message: assistantMessage,
      ...(typeof totalTokens === "number" ? { totalTokens } : {}),
      ...(assistantModel ? { model: assistantModel } : {}),
    });
    input.session.emittedAssistantMessageIds.add(responseMessageId);
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
