import { open } from "node:fs/promises";

const GOAL_RECORD_MARK = Buffer.from('"goal_status"');
const NEWLINE = 0x0a;
const CHUNK_BYTES = 1024 * 1024;

/**
 * Scans the raw bytes of a transcript from `startByte` for a `goal_status` record, without the
 * JSON tokenizer. Most transcripts have no goal, so a goal read can skip the parse. `end` is the
 * byte after the last complete line, where the next read starts.
 */
export const scanClaudeTranscriptForGoalRecords = async (
  path: string,
  startByte: number,
): Promise<{ hasGoalRecord: boolean; end: number }> => {
  const scan = await scanClaudeTranscriptForMark(path, startByte, GOAL_RECORD_MARK);
  return { hasGoalRecord: scan.found, end: scan.end };
};

/** Scans the raw bytes of a transcript from `startByte` for `mark`, without the JSON tokenizer. */
export const scanClaudeTranscriptForMark = async (
  path: string,
  startByte: number,
  mark: Buffer,
): Promise<{ found: boolean; end: number }> => {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(CHUNK_BYTES + mark.length);
    // The last bytes of a chunk stay at the start of the buffer, so a mark that spans two chunks
    // is found.
    let carried = 0;
    let position = startByte;
    let end = startByte;
    let found = false;
    for (;;) {
      const { bytesRead } = await file.read(buffer, carried, CHUNK_BYTES, position);
      if (bytesRead === 0) break;
      const filled = carried + bytesRead;
      const view = buffer.subarray(0, filled);
      if (!found && view.includes(mark)) found = true;
      const lastNewline = view.lastIndexOf(NEWLINE);
      if (lastNewline >= carried) end = position - carried + lastNewline + 1;
      position += bytesRead;
      carried = Math.min(mark.length - 1, filled);
      buffer.copy(buffer, 0, filled - carried, filled);
    }
    return { found, end };
  } finally {
    await file.close();
  }
};
