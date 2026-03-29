import {
  normalizeAgentUserMessageParts,
  type SendAgentUserMessageInput,
  serializeAgentUserMessagePartsToText,
} from "@openducktor/core";
import { setSessionActive } from "./event-stream/shared";
import { normalizeModelInput } from "./payload-mappers";
import { toOpenCodeRequestError } from "./request-errors";
import type { SessionRecord } from "./types";

type SlashCommandExecutionRequest = {
  command: string;
  arguments: string;
};

type SessionCommandClient = {
  command?: (input: unknown) => Promise<{ error?: unknown; response?: unknown }>;
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

const executeSlashCommand = async (args: {
  session: SessionRecord;
  slashCommandRequest: SlashCommandExecutionRequest;
  modelInput: ReturnType<typeof normalizeModelInput>;
}): Promise<void> => {
  const commandClient = args.session.client.session as SessionCommandClient;
  if (typeof commandClient.command !== "function") {
    throw new Error("OpenCode runtime client does not expose slash command execution.");
  }

  const response = await commandClient.command({
    sessionID: args.session.externalSessionId,
    directory: args.session.input.workingDirectory,
    command: args.slashCommandRequest.command,
    arguments: args.slashCommandRequest.arguments,
    ...(args.modelInput.variant ? { variant: args.modelInput.variant } : {}),
    ...(args.modelInput.agent ? { agent: args.modelInput.agent } : {}),
  });
  if (response.error) {
    throw toOpenCodeRequestError(
      "run slash command",
      response.error,
      response.response as { status?: unknown; statusText?: unknown } | undefined,
    );
  }
};

const executePromptMessage = async (args: {
  session: SessionRecord;
  request: SendAgentUserMessageInput;
  tools: Record<string, boolean>;
  modelInput: ReturnType<typeof normalizeModelInput>;
}): Promise<void> => {
  const serializedPromptText = serializeAgentUserMessagePartsToText(args.request.parts);
  const promptRequest = {
    sessionID: args.session.externalSessionId,
    directory: args.session.input.workingDirectory,
    ...(args.session.input.systemPrompt.trim().length > 0
      ? { system: args.session.input.systemPrompt }
      : {}),
    ...(args.modelInput.model ? { model: args.modelInput.model } : {}),
    ...(args.modelInput.variant ? { variant: args.modelInput.variant } : {}),
    ...(args.modelInput.agent ? { agent: args.modelInput.agent } : {}),
    tools: args.tools,
    parts: [{ type: "text" as const, text: serializedPromptText }],
  };

  const response = await args.session.client.session.promptAsync(promptRequest);
  if (response.error) {
    throw toOpenCodeRequestError("prompt session", response.error, response.response);
  }
};

export const sendUserMessage = async (input: {
  session: SessionRecord;
  request: SendAgentUserMessageInput;
  tools: Record<string, boolean>;
}): Promise<void> => {
  const model = input.request.model ?? input.session.input.model;
  const modelInput = normalizeModelInput(model);
  const slashCommandRequest = toSlashCommandExecutionRequest(input.request.parts);
  const queuedContent = serializeAgentUserMessagePartsToText(input.request.parts).trim();
  const pendingQueuedUserMessages = input.session.pendingQueuedUserMessages ?? [];
  input.session.pendingQueuedUserMessages = pendingQueuedUserMessages;
  const shouldTrackAsQueued =
    input.session.activeAssistantMessageId !== null && queuedContent.length > 0;

  if (shouldTrackAsQueued) {
    pendingQueuedUserMessages.push({
      content: queuedContent,
      ...(model ? { model } : {}),
    });
  }

  setSessionActive(input.session);
  try {
    if (slashCommandRequest) {
      await executeSlashCommand({
        session: input.session,
        slashCommandRequest,
        modelInput,
      });
      return;
    }

    await executePromptMessage({
      session: input.session,
      request: input.request,
      tools: input.tools,
      modelInput,
    });
  } catch (error) {
    if (shouldTrackAsQueued) {
      const matchIndex = pendingQueuedUserMessages.findIndex(
        (entry) => entry.content === queuedContent,
      );
      if (matchIndex >= 0) {
        pendingQueuedUserMessages.splice(matchIndex, 1);
      }
    }
    throw toOpenCodeRequestError("prompt session", error);
  }
};

export const __testExports = {
  toSlashCommandExecutionRequest,
};
