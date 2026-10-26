import type { TerminalFrameScheduler } from "@openducktor/frontend-core/terminals/terminal-viewport-policy";
import { encodeBase64 } from "@/rich-content/isolated-page/terminal-bytes";
import type {
  TerminalOutputChunk,
  TerminalPageInbound,
} from "@/rich-content/isolated-page/terminal-page-messages";

/** A host frame that the terminal page draws. */
export type TerminalPageFrame =
  | { kind: "output"; sequenceStart: number; sequenceEnd: number; payload: Uint8Array }
  | { kind: "snapshot"; sequenceEnd: number }
  | {
      kind: "restore";
      sequenceEnd: number;
      columns: number;
      rows: number;
      precedingJoinState: number;
      payload: Uint8Array;
    };

type PendingOutput = { sequenceStart: number; sequenceEnd: number; parts: Uint8Array[] };
type PendingEntry =
  | { kind: "output"; chunks: PendingOutput[] }
  | Exclude<TerminalPageFrame, { kind: "output" }>;

const joinParts = (parts: readonly Uint8Array[]): Uint8Array => {
  if (parts.length === 1 && parts[0]) return parts[0];
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
};

const toChunk = ({ sequenceStart, sequenceEnd, parts }: PendingOutput): TerminalOutputChunk => ({
  sequenceStart,
  sequenceEnd,
  bytes: encodeBase64(joinParts(parts)),
});

const toMessage = (entry: PendingEntry): TerminalPageInbound => {
  switch (entry.kind) {
    case "output":
      return { type: "terminal_output", chunks: entry.chunks.map(toChunk) };
    case "snapshot":
      return { type: "terminal_snapshot", sequenceEnd: entry.sequenceEnd };
    case "restore":
      return {
        type: "terminal_restore",
        sequenceEnd: entry.sequenceEnd,
        columns: entry.columns,
        rows: entry.rows,
        precedingJoinState: entry.precedingJoinState,
        bytes: encodeBase64(entry.payload),
      };
  }
};

/**
 * Sends host frames to the terminal page at most once per display frame, in host order. Output
 * frames between two other frames become one message. Contiguous output becomes one chunk, so
 * xterm.js gets one write for a burst. A gap or an overlap keeps its own chunk, because the page
 * sequencer must see it.
 */
export const createTerminalPageBatcher = ({
  post,
  requestFrame,
  cancelFrame,
}: TerminalFrameScheduler & { post: (message: TerminalPageInbound) => void }) => {
  let pending: PendingEntry[] = [];
  let frameId: number | null = null;

  const flush = (): void => {
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    const entries = pending;
    pending = [];
    for (const entry of entries) post(toMessage(entry));
  };

  return {
    push(frame: TerminalPageFrame): void {
      const last = pending.at(-1);
      if (frame.kind !== "output") pending.push(frame);
      else if (last?.kind !== "output") {
        pending.push({
          kind: "output",
          chunks: [
            {
              sequenceStart: frame.sequenceStart,
              sequenceEnd: frame.sequenceEnd,
              parts: [frame.payload],
            },
          ],
        });
      } else {
        const chunk = last.chunks.at(-1);
        if (chunk && chunk.sequenceEnd === frame.sequenceStart) {
          chunk.sequenceEnd = frame.sequenceEnd;
          chunk.parts.push(frame.payload);
        } else {
          last.chunks.push({
            sequenceStart: frame.sequenceStart,
            sequenceEnd: frame.sequenceEnd,
            parts: [frame.payload],
          });
        }
      }
      if (frameId === null) frameId = requestFrame(flush);
    },
    /** Drops the frames that wait for the next display frame. */
    clear(): void {
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      pending = [];
    },
  };
};
