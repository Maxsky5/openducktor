import { readFile, stat } from "node:fs/promises";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { hasOwnKey, LOCAL_ATTACHMENT_BYTE_LIMIT } from "@openducktor/contracts";
import type { AgentUserMessagePart, AgentUserMessageSourceText } from "@openducktor/core";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import { readText } from "./claude-agent-sdk-utils";

type ClaudeMessageContent = Exclude<SDKUserMessage["message"]["content"], string>;
type ClaudeMessageContentBlock = ClaudeMessageContent[number];
type ClaudeDocumentBlock = Extract<ClaudeMessageContentBlock, { type: "document" }>;
type ClaudeImageBlock = Extract<ClaudeMessageContentBlock, { type: "image" }>;

// Claude expands slash commands from streaming content blocks. A bare string is
// accepted by the type but reaches the model as ordinary prompt text.
// SAFETY: The runtime adapter builds this value from the contract fields required by `SDKUserMessage["message"]`.
const toClaudeMessage = (text: string): SDKUserMessage => ({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "text", text }],
  } as SDKUserMessage["message"],
  parent_tool_use_id: null,
});

const SUPPORTED_CLAUDE_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const SUPPORTED_CLAUDE_PDF_MIME = "application/pdf";
type ClaudeSupportedImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const MIME_BY_EXTENSION = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": SUPPORTED_CLAUDE_PDF_MIME,
  ".png": "image/png",
  ".webp": "image/webp",
} satisfies Record<string, ClaudeSupportedImageMime | typeof SUPPORTED_CLAUDE_PDF_MIME>;

const WORDLIKE_TEXT_START_PATTERN = /[\p{L}\p{N}_]/u;

const readExtension = (pathOrName: string): string => {
  const lastDot = pathOrName.lastIndexOf(".");
  return lastDot >= 0 ? pathOrName.slice(lastDot).toLowerCase() : "";
};

const isClaudeSupportedImageMime = (mime: string): mime is ClaudeSupportedImageMime =>
  SUPPORTED_CLAUDE_IMAGE_MIMES.has(mime);

const attachmentMimeForPath = (
  path: string,
): ClaudeSupportedImageMime | typeof SUPPORTED_CLAUDE_PDF_MIME | undefined => {
  const extension = readExtension(path);
  return hasOwnKey(MIME_BY_EXTENSION, extension) ? MIME_BY_EXTENSION[extension] : undefined;
};

const inferClaudeAttachmentMime = (
  attachment: Extract<AgentUserMessagePart, { kind: "attachment" }>["attachment"],
): ClaudeSupportedImageMime | typeof SUPPORTED_CLAUDE_PDF_MIME | null => {
  const mime = attachment.mime?.trim().toLowerCase();
  if (attachment.kind === "image") {
    if (mime && isClaudeSupportedImageMime(mime)) {
      return mime;
    }
    const inferred =
      attachmentMimeForPath(attachment.name) ?? attachmentMimeForPath(attachment.path);
    return inferred && isClaudeSupportedImageMime(inferred) ? inferred : null;
  }

  if (attachment.kind === "pdf") {
    if (mime === SUPPORTED_CLAUDE_PDF_MIME) {
      return SUPPORTED_CLAUDE_PDF_MIME;
    }
    const inferred =
      attachmentMimeForPath(attachment.name) ?? attachmentMimeForPath(attachment.path);
    return inferred === SUPPORTED_CLAUDE_PDF_MIME ? inferred : null;
  }

  return null;
};

const toClaudeAttachmentBlock = async (
  attachment: Extract<AgentUserMessagePart, { kind: "attachment" }>["attachment"],
  currentAttachmentBytes: number,
): Promise<{
  block: ClaudeImageBlock | ClaudeDocumentBlock;
  sizeBytes: number;
}> => {
  if (attachment.kind !== "image" && attachment.kind !== "pdf") {
    throw new HostValidationError({
      field: "parts",
      message: `Claude Agent SDK runtime cannot encode ${attachment.kind} attachments. Supported attachment kinds are image and pdf.`,
      details: { attachmentKind: attachment.kind, attachmentId: attachment.id },
    });
  }

  const mime = inferClaudeAttachmentMime(attachment);
  if (!mime) {
    throw new HostValidationError({
      field: "parts",
      message:
        attachment.kind === "image"
          ? `Claude Agent SDK runtime supports image attachments only as JPEG, PNG, GIF, or WebP. '${attachment.name}' has unsupported MIME type '${attachment.mime ?? "unknown"}'.`
          : `Claude Agent SDK runtime supports PDF attachments only as application/pdf. '${attachment.name}' has unsupported MIME type '${attachment.mime ?? "unknown"}'.`,
      details: {
        attachmentKind: attachment.kind,
        attachmentId: attachment.id,
        mime: attachment.mime,
      },
    });
  }

  const metadata = await stat(attachment.path).catch((cause: unknown) => {
    throw new HostOperationError({
      operation: "claude.attachment.stat",
      message: `Failed to inspect Claude attachment '${attachment.name}' at '${attachment.path}': ${errorMessage(cause)}`,
      cause,
    });
  });
  const totalBytes = currentAttachmentBytes + metadata.size;
  if (totalBytes > LOCAL_ATTACHMENT_BYTE_LIMIT) {
    throw new HostValidationError({
      field: "parts",
      message: "Claude attachments exceed the 32 MiB input memory budget.",
      details: {
        attachmentId: attachment.id,
        totalBytes,
        limitBytes: LOCAL_ATTACHMENT_BYTE_LIMIT,
      },
    });
  }

  const data = await readFile(attachment.path, "base64").catch((cause: unknown) => {
    throw new HostOperationError({
      operation: "claude.attachment.read",
      message: `Failed to read Claude attachment '${attachment.name}' from '${attachment.path}': ${errorMessage(cause)}`,
      cause,
    });
  });

  if (attachment.kind === "image") {
    // SAFETY: The runtime adapter builds this value from the contract fields required by `ClaudeSupportedImageMime`.
    return {
      block: {
        type: "image",
        source: {
          type: "base64",
          media_type: mime as ClaudeSupportedImageMime,
          data,
        },
      },
      sizeBytes: metadata.size,
    };
  }

  return {
    block: {
      type: "document",
      title: attachment.name,
      source: {
        type: "base64",
        media_type: SUPPORTED_CLAUDE_PDF_MIME,
        data,
      },
    },
    sizeBytes: metadata.size,
  };
};

const claudePartLabel = (part: AgentUserMessagePart): string => {
  switch (part.kind) {
    case "text":
      return "text";
    case "slash_command":
      return "slash command";
    case "file_reference":
      return part.file.kind === "directory" ? "folder reference" : "file reference";
    case "skill_mention":
      return "skill mention";
    case "subagent_reference":
      return "subagent reference";
    case "attachment":
      return `${part.attachment.kind} attachment`;
  }
};

const shouldInsertSyntheticSpaceBeforeClaudePart = (
  previousPart: AgentUserMessagePart | null,
  part: AgentUserMessagePart,
): boolean => {
  if (!previousPart || previousPart.kind === "text") {
    return false;
  }

  if (part.kind !== "text") {
    return true;
  }

  const firstCharacter = part.text.at(0);
  return firstCharacter !== undefined && WORDLIKE_TEXT_START_PATTERN.test(firstCharacter);
};

const SIMPLE_CLAUDE_FILE_REFERENCE_PATTERN = /^[^\s@"\\]+$/u;

const encodeClaudeFileReference = (path: string): string => {
  if (SIMPLE_CLAUDE_FILE_REFERENCE_PATTERN.test(path)) {
    return `@${path}`;
  }
  return `@"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

export const encodeClaudePromptTextWithSourceRanges = (parts: AgentUserMessagePart[]) => {
  let text = "";
  let previousPart: AgentUserMessagePart | null = null;
  const sourceTextByPartIndex: (AgentUserMessageSourceText | undefined)[] = Array.from({
    length: parts.length,
  });

  for (const [index, part] of parts.entries()) {
    if (part.kind === "attachment") {
      throw new HostValidationError({
        field: "parts",
        message: `Claude Agent SDK runtime cannot encode ${claudePartLabel(part)} prompt parts. Send plain text, a slash command, a skill mention, or a file reference.`,
        details: { partKind: part.kind },
      });
    }

    if (shouldInsertSyntheticSpaceBeforeClaudePart(previousPart, part)) {
      text += " ";
    }

    const sourceStart = text.length;
    switch (part.kind) {
      case "text":
        text += part.text;
        break;
      case "slash_command": {
        const trigger = readText(part.command.trigger);
        if (!trigger) {
          throw new HostValidationError({
            field: "parts",
            message: "Claude Agent SDK runtime cannot encode a slash command without a trigger.",
            details: { partKind: part.kind, commandId: part.command.id },
          });
        }
        text += `/${trigger}`;
        break;
      }
      case "skill_mention":
        text += `/${part.skill.name}`;
        break;
      case "subagent_reference":
        throw new HostValidationError({
          field: "parts",
          message: "Claude Agent SDK runtime does not support explicit subagent references.",
          details: { partKind: part.kind, subagent: part.subagent.name },
        });
      case "file_reference":
        text += encodeClaudeFileReference(part.file.path);
        break;
    }
    if (part.kind !== "text") {
      sourceTextByPartIndex[index] = {
        value: text.slice(sourceStart),
        start: sourceStart,
        end: text.length,
      };
    }
    previousPart = part;
  }

  const leadingWhitespaceLength = text.length - text.trimStart().length;
  const trimmedText = text.trim();
  return {
    text: trimmedText,
    sourceTextByPartIndex: sourceTextByPartIndex.map((sourceText) => {
      if (!sourceText) {
        return undefined;
      }
      return {
        value: sourceText.value,
        start: sourceText.start - leadingWhitespaceLength,
        end: sourceText.end - leadingWhitespaceLength,
      };
    }),
  } satisfies {
    text: string;
    sourceTextByPartIndex: readonly (AgentUserMessageSourceText | undefined)[];
  };
};

export const encodeClaudePromptText = (parts: AgentUserMessagePart[]): string =>
  encodeClaudePromptTextWithSourceRanges(parts).text;

export const toClaudeMessageFromParts = async (
  parts: AgentUserMessagePart[],
): Promise<SDKUserMessage> => {
  const hasAttachments = parts.some((part) => part.kind === "attachment");
  if (!hasAttachments) {
    return toClaudeMessage(encodeClaudePromptText(parts));
  }

  const content: ClaudeMessageContent = [];
  let attachmentBytes = 0;
  let text = "";
  let previousPart: AgentUserMessagePart | null = null;

  const flushText = () => {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      content.push({ type: "text", text: trimmed });
    }
    text = "";
  };

  for (const part of parts) {
    if (shouldInsertSyntheticSpaceBeforeClaudePart(previousPart, part)) {
      text += " ";
    }

    switch (part.kind) {
      case "text":
        text += part.text;
        break;
      case "slash_command": {
        const trigger = readText(part.command.trigger);
        if (!trigger) {
          throw new HostValidationError({
            field: "parts",
            message: "Claude Agent SDK runtime cannot encode a slash command without a trigger.",
            details: { partKind: part.kind, commandId: part.command.id },
          });
        }
        text += `/${trigger}`;
        break;
      }
      case "skill_mention":
        text += `/${part.skill.name}`;
        break;
      case "subagent_reference":
        throw new HostValidationError({
          field: "parts",
          message: "Claude Agent SDK runtime does not support explicit subagent references.",
          details: { partKind: part.kind, subagent: part.subagent.name },
        });
      case "file_reference":
        text += encodeClaudeFileReference(part.file.path);
        break;
      case "attachment":
        flushText();
        {
          const encodedAttachment = await toClaudeAttachmentBlock(part.attachment, attachmentBytes);
          attachmentBytes += encodedAttachment.sizeBytes;
          content.push(encodedAttachment.block);
        }
        break;
    }
    previousPart = part;
  }

  flushText();

  // SAFETY: The runtime adapter builds this value from the contract fields required by `SDKUserMessage["message"]`.
  return {
    type: "user",
    message: {
      role: "user",
      content,
    } as SDKUserMessage["message"],
    parent_tool_use_id: null,
  };
};
