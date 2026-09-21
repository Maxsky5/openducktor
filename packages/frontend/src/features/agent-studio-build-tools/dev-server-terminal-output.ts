import type { AgentStudioDevServerTerminalChunkEntry } from "./dev-server-log-buffer";

export const readTerminalOutput = (
  entries: readonly AgentStudioDevServerTerminalChunkEntry[],
  afterSequence: number | null,
): string => {
  let start = 0;
  if (afterSequence !== null) {
    let end = entries.length;
    // Sequences rise but may skip values. Find the first unread entry.
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      const entry = entries[middle];
      if (!entry) {
        throw new Error(`Missing dev server terminal chunk at offset ${middle}.`);
      }
      if (entry.sequence <= afterSequence) {
        start = middle + 1;
      } else {
        end = middle;
      }
    }
  }

  let output = "";
  for (let index = start; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      throw new Error(`Missing dev server terminal chunk at offset ${index}.`);
    }
    output += entry.data;
  }
  return output;
};
