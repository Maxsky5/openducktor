import {
  type AgentUserMessageDisplayPart,
  normalizeAgentUserMessageParts,
  type SendAgentUserMessageInput,
} from "@openducktor/core";
import { setSessionActive } from "./event-stream/shared";
import { detectAgentFileReferenceMime } from "./file-reference-utils";
import { buildOpenCodePromptText } from "./opencode-user-message-encoding";
import { resolveAgainstWorkingDirectory, toFileUrl } from "./path-utils";
import { normalizeModelInput, resolveAssistantResponseMessageId } from "./payload-mappers";
import { toOpenCodeRequestError } from "./request-errors";
import type { SessionRecord } from "./types";
import {
  buildQueuedRequestAttachmentIdentitySignature,
  buildQueuedRequestSignature,
} from "./user-message-signatures";

type SlashCommandExecutionRequest = {
  command: string;
  arguments: string;
};

type SessionCommandClient = {
  command?: (input: unknown) => Promise<{ error?: unknown; response?: unknown }>;
};

type PreparedUserSend = {
  execute: (args: {
    session: SessionRecord;
    modelInput: ReturnType<typeof normalizeModelInput>;
    tools: Record<string, boolean>;
  }) => Promise<{ assistantMessageId: string | null }>;
};

type OpenCodePromptPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "file";
      mime: string;
      url: string;
      filename: string;
      source?: {
        type: "file";
        path: string;
        text: {
          value: string;
          start: number;
          end: number;
        };
      };
    };

const toCommandModelInput = (
  modelInput: ReturnType<typeof normalizeModelInput>,
): string | undefined => {
  if (!modelInput.model) {
    return undefined;
  }
  return `${modelInput.model.providerID}/${modelInput.model.modelID}`;
};

const toPromptFilePart = (
  fileReference: ReturnType<typeof buildOpenCodePromptText>["fileReferences"][number],
  workingDirectory: string,
): Extract<OpenCodePromptPart, { type: "file" }> => {
  const normalizedPath = fileReference.file.path.trim();
  if (normalizedPath.length === 0) {
    throw new Error("OpenCode file references require a non-empty path.");
  }

  return {
    type: "file",
    mime: detectAgentFileReferenceMime(fileReference.file),
    url: toFileUrl(resolveAgainstWorkingDirectory(workingDirectory, normalizedPath)),
    filename: fileReference.file.name,
    source: {
      type: "file",
      path: normalizedPath,
      text: fileReference.sourceText,
    },
  };
};

const toPromptParts = (
  parts: SendAgentUserMessageInput["parts"],
  workingDirectory: string,
): OpenCodePromptPart[] => {
  const promptText = buildOpenCodePromptText(parts);
  return [
    { type: "text", text: promptText.text },
    ...promptText.fileReferences.map((fileReference) =>
      toPromptFilePart(fileReference, workingDirectory),
    ),
    ...parts.flatMap((part) => {
      if (part.kind !== "attachment") {
        return [];
      }

      const normalizedPath = part.attachment.path.trim();
      if (normalizedPath.length === 0) {
        throw new Error("OpenCode attachments require a non-empty path.");
      }
      if (!part.attachment.mime || part.attachment.mime.trim().length === 0) {
        throw new Error(`OpenCode attachment "${part.attachment.name}" is missing a MIME type.`);
      }

      return [
        {
          type: "file" as const,
          mime: part.attachment.mime,
          url: toFileUrl(resolveAgainstWorkingDirectory(workingDirectory, normalizedPath)),
          filename: part.attachment.name,
        },
      ];
    }),
  ];
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
  if (
    normalizedParts.some((part) => part.kind === "file_reference" || part.kind === "attachment")
  ) {
    throw toOpenCodeRequestError(
      "run slash command",
      new Error(
        "OpenCode slash commands do not support structured attachments or file references.",
      ),
    );
  }
  if (slashCommandIndexes.length > 1) {
    throw new Error("OpenCode supports only one slash command token per message.");
  }

  const commandIndex = slashCommandIndexes[0];
  if (commandIndex === undefined) {
    return null;
  }

  const leadingParts = normalizedParts.slice(0, commandIndex);
  if (leadingParts.some((part) => part.kind !== "text" || part.text.trim().length > 0)) {
    throw new Error("OpenCode slash commands must be the first meaningful message segment.");
  }

  const commandPart = normalizedParts[commandIndex];
  if (!commandPart || commandPart.kind !== "slash_command") {
    return null;
  }

  const trailingText = normalizedParts
    .slice(commandIndex + 1)
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("");
  return {
    command: commandPart.command.trigger,
    arguments: trailingText.trim(),
  };
};

const preparePromptSend = (request: SendAgentUserMessageInput): PreparedUserSend => {
  return {
    execute: async ({ session, modelInput, tools }) => {
      const promptParts = toPromptParts(request.parts, session.input.workingDirectory);
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
        parts: promptParts,
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
  _request: SendAgentUserMessageInput,
  slashCommandRequest: SlashCommandExecutionRequest,
): PreparedUserSend => {
  return {
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

const readQueuedAttachmentDisplayParts = (
  parts: SendAgentUserMessageInput["parts"],
): Extract<AgentUserMessageDisplayPart, { kind: "attachment" }>[] => {
  return parts.flatMap((part) => {
    if (part.kind !== "attachment") {
      return [];
    }

    return [{ kind: "attachment", attachment: part.attachment }];
  });
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
  const pendingQueuedUserMessages = input.session.pendingQueuedUserMessages ?? [];
  input.session.pendingQueuedUserMessages = pendingQueuedUserMessages;
  const queuedAttachmentParts = readQueuedAttachmentDisplayParts(input.request.parts);
  const shouldTrackPendingSend =
    normalizeAgentUserMessageParts(input.request.parts).length > 0 &&
    (input.session.activeAssistantMessageId !== null || queuedAttachmentParts.length > 0);
  const queuedEntry = shouldTrackPendingSend
    ? {
        signature: buildQueuedRequestSignature(input.request.parts, model ?? undefined),
        ...(queuedAttachmentParts.length > 0
          ? {
              attachmentIdentitySignature: buildQueuedRequestAttachmentIdentitySignature(
                input.request.parts,
                model ?? undefined,
              ),
            }
          : {}),
        ...(queuedAttachmentParts.length > 0 ? { attachmentParts: queuedAttachmentParts } : {}),
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
