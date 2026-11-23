import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ContentBlock } from "@agentclientprotocol/sdk/unstable";
import {
  type AgentAttachmentKind,
  type AgentUserMessageDisplayPart,
  type AgentUserMessagePart,
  detectAgentFileReferenceKind,
  serializeAgentUserMessagePartsToText,
  shouldInsertSyntheticSpaceBeforePart,
} from "@openducktor/core";
import {
  basenameForPath,
  normalizePathSeparators,
  pathStartsWith,
} from "@openducktor/path-support";
import { readStagedAttachmentOriginalName } from "../../application/attachments/local-attachment-index";
import { isAntigravitySkillName } from "./antigravity-session-updates";
import type { AntigravityUserMessage } from "./antigravity-transcript";

/** A `/<name>` token that stands alone in the text. */
const SLASH_TOKEN_PATTERN = /(?<=^|\s)\/([A-Za-z0-9][\w-]*)(?=\s|$)/g;

/**
 * Splits text into text and skill parts. Antigravity runs a skill from its `/<name>` text, and
 * history returns that text, so a live message and its replay show the same skill parts.
 */
const splitSkillMentions = (text: string): AgentUserMessageDisplayPart[] => {
  const parts: AgentUserMessageDisplayPart[] = [];
  let start = 0;
  for (const match of text.matchAll(SLASH_TOKEN_PATTERN)) {
    const name = match[1];
    if (!name || !isAntigravitySkillName(name)) continue;
    if (match.index > start) parts.push({ kind: "text", text: text.slice(start, match.index) });
    parts.push({ kind: "skill_mention", skill: { id: name, name, path: name } });
    start = match.index + match[0].length;
  }
  if (start < text.length) parts.push({ kind: "text", text: text.slice(start) });
  return parts;
};

/**
 * The parts as Antigravity takes them. Antigravity runs a skill as its slash command, so a skill
 * mention sends `/<name>`, and history returns it as that text.
 */
const toAntigravityParts = (parts: AgentUserMessagePart[]): AgentUserMessagePart[] =>
  parts.map((part) =>
    part.kind === "skill_mention"
      ? {
          kind: "slash_command",
          command: {
            id: part.skill.id,
            trigger: part.skill.name,
            title: part.skill.name,
            source: "skill",
            hints: [],
          },
        }
      : part,
  );

const toDisplayPart = (part: AgentUserMessagePart): AgentUserMessageDisplayPart | null => {
  switch (part.kind) {
    case "text":
      return { kind: "text", text: part.text };
    case "slash_command":
      return { kind: "text", text: `/${part.command.trigger}` };
    case "file_reference":
      return { kind: "file_reference", file: part.file };
    case "attachment":
      // History knows only the staged path, so the live message uses it as the ID too.
      return { kind: "attachment", attachment: { ...part.attachment, id: part.attachment.path } };
    default:
      return null;
  }
};

/**
 * The user message that the live event and the history show for the parts of one message. Text
 * next to text joins into one part, as the prompt sends it and the replay returns it.
 */
export const toAntigravityUserMessage = (
  messageParts: AgentUserMessagePart[],
): AntigravityUserMessage => {
  const parts = toAntigravityParts(messageParts);
  const displayParts: AgentUserMessageDisplayPart[] = [];
  let previous: AgentUserMessagePart | null = null;
  for (const part of parts) {
    const display = toDisplayPart(part);
    if (display) {
      const last = displayParts.at(-1);
      // A word after a command or reference gets a space, as the prompt encoding adds it. A command
      // after a reference starts its own text block, so it gets no space.
      const needsSpace =
        display.kind === "text" &&
        (part.kind === "text" || last?.kind === "text") &&
        shouldInsertSyntheticSpaceBeforePart(previous, part);
      const shown = needsSpace ? { ...display, text: ` ${display.text}` } : display;
      if (last?.kind === "text" && shown.kind === "text") {
        displayParts[displayParts.length - 1] = { kind: "text", text: `${last.text}${shown.text}` };
      } else {
        displayParts.push(shown);
      }
    }
    previous = part;
  }
  const text = serializeAgentUserMessagePartsToText(parts);
  return {
    text,
    displayParts: withSourceText(
      text,
      displayParts.flatMap((part) =>
        part.kind === "text" ? splitSkillMentions(part.text) : [part],
      ),
    ),
  };
};

/** The text of a reference part in the message text. */
const referenceMarker = (part: AgentUserMessageDisplayPart): string | null => {
  switch (part.kind) {
    case "skill_mention":
      return `/${part.skill.name}`;
    case "file_reference":
      return `@${part.file.path}`;
    default:
      return null;
  }
};

/** Gives each reference the place of its text in the message, so its chip takes that place. */
const withSourceText = (
  text: string,
  parts: AgentUserMessageDisplayPart[],
): AgentUserMessageDisplayPart[] => {
  let cursor = 0;
  return parts.map((part) => {
    const marker = referenceMarker(part);
    if (marker === null || (part.kind !== "skill_mention" && part.kind !== "file_reference"))
      return part;
    const start = text.indexOf(marker, cursor);
    if (start < 0) return part;
    cursor = start + marker.length;
    return { ...part, sourceText: { value: marker, start, end: cursor } };
  });
};

const fileUri = (absolutePath: string, directory: boolean): string => {
  const uri = pathToFileURL(absolutePath).href;
  return directory && !uri.endsWith("/") ? `${uri}/` : uri;
};

const encodeAntigravityPart =
  (workingDirectory: string) =>
  (part: AgentUserMessagePart): ContentBlock => {
    switch (part.kind) {
      case "text":
        return { type: "text", text: part.text };
      case "slash_command":
        return { type: "text", text: `/${part.command.trigger}` };
      case "file_reference": {
        const absolutePath = resolve(workingDirectory, part.file.path);
        return {
          type: "resource_link",
          uri: fileUri(absolutePath, part.file.kind === "directory"),
          name: part.file.name,
        };
      }
      case "attachment": {
        const link: ContentBlock = {
          type: "resource_link",
          uri: fileUri(part.attachment.path, false),
          name: part.attachment.name,
        };
        if (part.attachment.mime) link.mimeType = part.attachment.mime;
        return link;
      }
      default:
        throw new Error(`Antigravity cannot send ${part.kind} message parts.`);
    }
  };

/**
 * Encodes a message as ACP content. A slash command becomes `/<name>` text, and file references
 * and attachments become `resource_link` blocks that the agent reads with its own file tools.
 * Text next to text joins into one block. A replay has no message IDs, so two text blocks in a
 * row are the sign that a new user message starts, except for a slash command and its arguments.
 */
export const encodeAntigravityPrompt = (
  parts: AgentUserMessagePart[],
  workingDirectory: string,
): ContentBlock[] => {
  const encode = encodeAntigravityPart(workingDirectory);
  const blocks: ContentBlock[] = [];
  let previous: AgentUserMessagePart | null = null;
  for (const part of toAntigravityParts(parts)) {
    const block = encode(part);
    const last = blocks.at(-1);
    if (last?.type === "text" && block.type === "text") {
      const space = shouldInsertSyntheticSpaceBeforePart(previous, part) ? " " : "";
      blocks[blocks.length - 1] = { type: "text", text: `${last.text}${space}${block.text}` };
    } else {
      blocks.push(block);
    }
    previous = part;
  }
  return blocks;
};

const attachmentKind = (path: string, mime: string | undefined): AgentAttachmentKind | null => {
  if (mime === "application/pdf" || path.toLowerCase().endsWith(".pdf")) return "pdf";
  const kind = detectAgentFileReferenceKind(
    mime === undefined ? { filePath: path } : { filePath: path, mime },
  );
  return kind === "image" || kind === "video" ? kind : null;
};

/**
 * Reads the user message blocks of a `session/load` replay back into message parts. A link under
 * the attachment staging directory is an attachment, and other links are file or folder
 * references.
 */
export const readAntigravityUserBlocks = (
  blocks: ContentBlock[],
  workingDirectory: string,
  attachmentStageDirectory: string,
): AgentUserMessagePart[] =>
  blocks.flatMap((block): AgentUserMessagePart[] => {
    if (block.type === "text") return [{ kind: "text", text: block.text }];
    if (block.type !== "resource_link" || !block.uri.startsWith("file:")) return [];
    const directory = block.uri.endsWith("/");
    const absolutePath = fileURLToPath(block.uri);
    const mime = block.mimeType ?? undefined;
    if (pathStartsWith(absolutePath, attachmentStageDirectory)) {
      const kind = attachmentKind(absolutePath, mime);
      if (kind) {
        const attachment: Extract<AgentUserMessagePart, { kind: "attachment" }>["attachment"] = {
          id: absolutePath,
          path: absolutePath,
          // Antigravity replays the staged file name, so the name drops its staging prefix.
          name: readStagedAttachmentOriginalName({
            path: absolutePath,
            fileName: basenameForPath(absolutePath),
          }),
          kind,
        };
        if (mime) attachment.mime = mime;
        return [{ kind: "attachment", attachment }];
      }
    }
    const relativePath = relative(workingDirectory, absolutePath);
    const path = normalizePathSeparators(
      relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)
        ? relativePath
        : absolutePath,
    ).replace(/\/+$/, "");
    return [
      {
        kind: "file_reference",
        file: {
          id: path,
          path,
          name: block.name || basenameForPath(path),
          kind: detectAgentFileReferenceKind({ filePath: path, isDirectory: directory }),
        },
      },
    ];
  });
