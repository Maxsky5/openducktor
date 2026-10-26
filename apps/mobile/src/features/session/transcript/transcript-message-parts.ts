import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  type MarkdownChunk,
  type MarkdownChunks,
  splitMarkdownChunks,
} from "@/rich-content/markdown/markdown-chunks";
import { createHostContentCache } from "@/rich-content/lru-cache";
import { messageRowKind, type PresentToolCall } from "./transcript-row-type";

/** An answer or a reasoning text longer than this shows as several list rows. */
export const LONG_MESSAGE_CHARACTERS = 6000;

/** The least text in each part of a long message: about two screens. */
export const MESSAGE_PART_CHARACTERS = 2500;

/**
 * One part of a long answer or reasoning text: a chunk of its Markdown as a list row of its own.
 * The list then renders only the parts near the screen, and each part parses its text when it
 * renders.
 */
export type MessagePartItem = {
  readonly kind: "message_part";
  readonly key: string;
  /** The row of the whole message: an answer, or reasoning with the Thinking label. */
  readonly look: "answer" | "reasoning";
  /** The key of the message row. */
  readonly rowKey: string;
  readonly messageId: string;
  readonly chunk: MarkdownChunk;
  /** The chunk before this one. Its last block sets the space above this part. */
  readonly previous: MarkdownChunk | null;
  /** The whole message, on the last part only, which ends the row of the message. */
  readonly message: AgentChatMessage | null;
};

/** The parse cache key of a part: the message ID and the place of its chunk. */
export const messagePartRevision = (messageId: string, chunk: MarkdownChunk): string =>
  `${messageId}:${chunk.start}`;

type MessageRow = Extract<AgentChatTranscriptRow, { kind: "message" }>;
type SplitMessage = { readonly chunks: MarkdownChunks; readonly parts: readonly MessagePartItem[] };

// Every list of the transcript asks for the parts of the same row object.
const partsByRow = new WeakMap<MessageRow, readonly MessagePartItem[] | null>();
// A streamed message keeps its earlier chunks and the part objects of these chunks, so only the
// last part renders again.
const latestSplits = createHostContentCache<string, SplitMessage>(32);

const buildParts = (
  row: MessageRow,
  look: MessagePartItem["look"],
  chunks: readonly MarkdownChunk[],
  earlier: readonly MessagePartItem[],
): MessagePartItem[] =>
  chunks.map((chunk, index) => {
    const previous = chunks[index - 1] ?? null;
    const last = index === chunks.length - 1;
    const kept = earlier[index];
    if (!last && kept?.chunk === chunk && kept.previous === previous && kept.message === null) {
      return kept;
    }
    return {
      kind: "message_part",
      key: `${row.key}:${chunk.start}`,
      look,
      rowKey: row.key,
      messageId: row.message.id,
      chunk,
      previous,
      message: last ? row.message : null,
    };
  });

const partLook = (
  message: AgentChatMessage,
  presentToolCall: PresentToolCall,
): MessagePartItem["look"] | null => {
  const { kind } = messageRowKind(message, presentToolCall);
  if (kind === "assistant") return "answer";
  return kind === "reasoning" ? "reasoning" : null;
};

/** The parts of a long answer or reasoning row, or null for a row that shows whole. */
export const messageParts = (
  row: AgentChatTranscriptRow,
  presentToolCall: PresentToolCall,
): readonly MessagePartItem[] | null => {
  if (row.kind !== "message" || row.message.content.length < LONG_MESSAGE_CHARACTERS) return null;
  const known = partsByRow.get(row);
  if (known !== undefined) return known;
  let parts: readonly MessagePartItem[] | null = null;
  const look = partLook(row.message, presentToolCall);
  if (look !== null) {
    const latest = latestSplits.get(row.key) ?? null;
    const chunks = splitMarkdownChunks(
      row.message.content,
      MESSAGE_PART_CHARACTERS,
      latest?.chunks ?? null,
    );
    if (chunks.chunks.length > 1) {
      parts = buildParts(row, look, chunks.chunks, latest?.parts ?? []);
      latestSplits.set(row.key, { chunks, parts });
    }
  }
  partsByRow.set(row, parts);
  return parts;
};
