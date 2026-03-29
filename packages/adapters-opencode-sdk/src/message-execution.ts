import {
  normalizeAgentUserMessageParts,
  type SendAgentUserMessageInput,
  serializeAgentUserMessagePartsToText,
} from "@openducktor/core";
import { setSessionActive } from "./event-stream/shared";
import { normalizeModelInput, resolveAssistantResponseMessageId } from "./payload-mappers";
import { toOpenCodeRequestError } from "./request-errors";
import type { SessionRecord } from "./types";

type SlashCommandExecutionRequest = {
  command: string;
  arguments: string;
};

type SessionCommandClient = {
  command?: (input: unknown) => Promise<{ error?: unknown; response?: unknown }>;
};

type PreparedUserSend = {
  queuedContent: string;
  execute: (args: {
    session: SessionRecord;
    modelInput: ReturnType<typeof normalizeModelInput>;
    tools: Record<string, boolean>;
  }) => Promise<{ assistantMessageId: string | null }>;
};

const toCommandModelInput = (
  modelInput: ReturnType<typeof normalizeModelInput>,
): string | undefined => {
  if (!modelInput.model) {
    return undefined;
  }
  return `${modelInput.model.providerID}/${modelInput.model.modelID}`;
};

const toSlashCommandExecutionRequest = (
  parts: SendAgentUserMessageInput["parts"],
): SlashCommandExecutionRequest | null => {
  const normalizedParts = normalizeAgentUserMessageParts(parts);
  const slashCommandIndexes = normalizedParts.flatMap((part, index) =>
    part.kind === "slash_command" ? [index] : [],
  );
  if (slashCommandIndexes.length === 0) {
    return null;
  }
  if (slashCommandIndexes.length > 1) {
    throw new Error("OpenCode supports only one slash command token per message.");
  }

  const commandIndex = slashCommandIndexes[0];
  if (commandIndex === undefined) {
    return null;
  }

  const leadingText = serializeAgentUserMessagePartsToText(normalizedParts.slice(0, commandIndex));
  if (leadingText.trim().length > 0) {
    throw new Error("OpenCode slash commands must be the first meaningful message segment.");
  }

  const commandPart = normalizedParts[commandIndex];
  if (!commandPart || commandPart.kind !== "slash_command") {
    return null;
  }

  const trailingText = serializeAgentUserMessagePartsToText(
    normalizedParts.slice(commandIndex + 1),
  );
  return {
    command: commandPart.command.trigger,
    arguments: trailingText.trim(),
  };
};

const preparePromptSend = (request: SendAgentUserMessageInput): PreparedUserSend => {
  const queuedContent = serializeAgentUserMessagePartsToText(request.parts).trim();

  return {
    queuedContent,
    execute: async ({ session, modelInput, tools }) => {
      const promptRequest = {
        sessionID: session.externalSessionId,
        directory: session.input.workingDirectory,
        ...(session.input.systemPrompt.trim().length > 0
          ? { system: session.input.systemPrompt }
          : {}),
        ...(modelInput.model ? { model: modelInput.model } : {}),
        ...(modelInput.variant ? { variant: modelInput.variant } : {}),
        ...(modelInput.agent ? { agent: modelInput.agent } : {}),
        tools,
        parts: [{ type: "text" as const, text: queuedContent }],
      };

      const response = await session.client.session.promptAsync(promptRequest);
      if (response.error) {
        throw toOpenCodeRequestError("prompt session", response.error, response.response);
      }
      return {
        assistantMessageId: resolveAssistantResponseMessageId(response.data),
      };
    },
  };
};

const prepareSlashCommandSend = (
  request: SendAgentUserMessageInput,
  slashCommandRequest: SlashCommandExecutionRequest,
): PreparedUserSend => {
  const queuedContent = serializeAgentUserMessagePartsToText(request.parts).trim();

  return {
    queuedContent,
    execute: async ({ session, modelInput }) => {
      const commandClient = session.client.session as SessionCommandClient;
      if (typeof commandClient.command !== "function") {
        throw new Error("OpenCode runtime client does not expose slash command execution.");
      }

      const commandModel = toCommandModelInput(modelInput);

      const response = await commandClient.command({
        sessionID: session.externalSessionId,
        directory: session.input.workingDirectory,
        command: slashCommandRequest.command,
        arguments: slashCommandRequest.arguments,
        ...(commandModel ? { model: commandModel } : {}),
        ...(modelInput.variant ? { variant: modelInput.variant } : {}),
        ...(modelInput.agent ? { agent: modelInput.agent } : {}),
      });
      if (response.error) {
        throw toOpenCodeRequestError(
          "run slash command",
          response.error,
          response.response as { status?: unknown; statusText?: unknown } | undefined,
        );
      }
      return {
        assistantMessageId: resolveAssistantResponseMessageId(
          (response as { data?: unknown }).data,
        ),
      };
    },
  };
};

export const sendUserMessage = async (input: {
  session: SessionRecord;
  request: SendAgentUserMessageInput;
  tools: Record<string, boolean>;
}): Promise<void> => {
  const model = input.request.model ?? input.session.input.model;
  const modelInput = normalizeModelInput(model);
  const slashCommandRequest = toSlashCommandExecutionRequest(input.request.parts);
  const preparedSend = slashCommandRequest
    ? prepareSlashCommandSend(input.request, slashCommandRequest)
    : preparePromptSend(input.request);
  const queuedContent = preparedSend.queuedContent;
  const pendingQueuedUserMessages = input.session.pendingQueuedUserMessages ?? [];
  input.session.pendingQueuedUserMessages = pendingQueuedUserMessages;
  const shouldTrackAsQueued =
    input.session.activeAssistantMessageId !== null && queuedContent.length > 0;
  const queuedEntry = shouldTrackAsQueued
    ? {
        content: queuedContent,
        ...(model ? { model } : {}),
      }
    : null;

  if (queuedEntry) {
    pendingQueuedUserMessages.push(queuedEntry);
  }

  setSessionActive(input.session);
  try {
    const { assistantMessageId } = await preparedSend.execute({
      session: input.session,
      tools: input.tools,
      modelInput,
    });
    if (assistantMessageId) {
      input.session.activeAssistantMessageId = assistantMessageId;
    }
  } catch (error) {
    if (queuedEntry) {
      const queuedEntryIndex = pendingQueuedUserMessages.indexOf(queuedEntry);
      if (queuedEntryIndex >= 0) {
        pendingQueuedUserMessages.splice(queuedEntryIndex, 1);
      }
    }
    if (error instanceof Error && error.message.startsWith("OpenCode request failed:")) {
      throw error;
    }
    throw toOpenCodeRequestError("prompt session", error);
  }
};

export const __testExports = {
  toSlashCommandExecutionRequest,
};
