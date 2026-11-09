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
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(CHUNK_BYTES + GOAL_RECORD_MARK.length);
    // The last bytes of a chunk stay at the start of the buffer, so a mark that spans two chunks
    // is found.
    let carried = 0;
    let position = startByte;
    let end = startByte;
    let hasGoalRecord = false;
    for (;;) {
      const { bytesRead } = await file.read(buffer, carried, CHUNK_BYTES, position);
      if (bytesRead === 0) break;
      const filled = carried + bytesRead;
      const view = buffer.subarray(0, filled);
      if (!hasGoalRecord && view.includes(GOAL_RECORD_MARK)) hasGoalRecord = true;
      const lastNewline = view.lastIndexOf(NEWLINE);
      if (lastNewline >= carried) end = position - carried + lastNewline + 1;
      position += bytesRead;
      carried = Math.min(GOAL_RECORD_MARK.length - 1, filled);
      buffer.copy(buffer, 0, filled - carried, filled);
    }
    return { hasGoalRecord, end };
  } finally {
    await file.close();
  }
};
