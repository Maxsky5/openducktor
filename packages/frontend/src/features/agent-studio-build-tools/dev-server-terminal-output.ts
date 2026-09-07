import type { AgentStudioDevServerTerminalChunkEntry } from "./dev-server-log-buffer";

export const readDevServerTerminalOutput = (
  entries: readonly AgentStudioDevServerTerminalChunkEntry[],
  lastRenderedSequence: number | null,
): string => {
  let start = 0;
  if (lastRenderedSequence !== null) {
    let end = entries.length;
    // Sequences increase but can contain gaps. Find the first unseen entry.
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      const entry = entries[middle];
      if (!entry) {
        throw new Error(`Missing dev server terminal chunk at offset ${middle}.`);
      }
      if (entry.sequence <= lastRenderedSequence) {
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
