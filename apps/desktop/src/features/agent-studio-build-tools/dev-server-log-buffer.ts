import type {
  DevServerGroupState,
  DevServerScriptState,
  DevServerTerminalChunk,
} from "@openducktor/contracts";

export const MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS = 2_000;

export type AgentStudioDevServerTerminalChunkEntry = DevServerTerminalChunk;

export type AgentStudioDevServerTerminalBuffer = {
  entries: readonly AgentStudioDevServerTerminalChunkEntry[];
  lastSequence: number | null;
  firstSnapshotSequence?: number | null;
  lastSnapshotSequence?: number | null;
  resetToken: number;
  snapshotEntryCount?: number;
};

type DevServerTerminalBufferState = {
  entries: AgentStudioDevServerTerminalChunkEntry[];
  firstSnapshotSequence: number | null;
  head: number;
  lastSnapshotSequence: number | null;
  size: number;
  lastSequence: number | null;
  resetToken: number;
  snapshotEntryCount: number;
};

export type DevServerTerminalBufferStore = Map<string, DevServerTerminalBufferState>;

export const trimDevServerTerminalChunks = (
  chunks: DevServerTerminalChunk[],
): DevServerTerminalChunk[] => {
  if (chunks.length <= MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS) {
    return chunks;
  }

  return chunks.slice(-MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS);
};

const readBufferedSequenceWindow = (
  chunks: readonly DevServerTerminalChunk[],
): {
  count: number;
  firstSequence: number | null;
  lastSequence: number | null;
} => {
  return {
    count: chunks.length,
    firstSequence: chunks[0]?.sequence ?? null,
    lastSequence: chunks.at(-1)?.sequence ?? null,
  };
};

const createDevServerTerminalBufferState = (): DevServerTerminalBufferState => ({
  entries: [],
  firstSnapshotSequence: null,
  head: 0,
  lastSnapshotSequence: null,
  size: 0,
  lastSequence: null,
  resetToken: 0,
  snapshotEntryCount: 0,
});

const getOrCreateDevServerTerminalBufferState = (
  store: DevServerTerminalBufferStore,
  scriptId: string,
): DevServerTerminalBufferState => {
  const existingBuffer = store.get(scriptId);
  if (existingBuffer) {
    return existingBuffer;
  }

  const nextBuffer = createDevServerTerminalBufferState();
  store.set(scriptId, nextBuffer);
  return nextBuffer;
};

export const createDevServerTerminalBufferStore = (): DevServerTerminalBufferStore => new Map();

export const appendDevServerTerminalChunk = (
  store: DevServerTerminalBufferStore,
  terminalChunk: DevServerTerminalChunk,
): void => {
  const buffer = getOrCreateDevServerTerminalBufferState(store, terminalChunk.scriptId);
  if (buffer.lastSequence !== null && terminalChunk.sequence <= buffer.lastSequence) {
    return;
  }

  if (buffer.size < MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS) {
    const insertionIndex = (buffer.head + buffer.size) % MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS;
    buffer.entries[insertionIndex] = terminalChunk;
    buffer.size += 1;
  } else {
    buffer.entries[buffer.head] = terminalChunk;
    buffer.head = (buffer.head + 1) % MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS;
  }

  buffer.lastSequence = terminalChunk.sequence;
};

export const replaceDevServerTerminalBuffer = (
  store: DevServerTerminalBufferStore,
  scriptId: string,
  terminalChunks: DevServerTerminalChunk[],
): void => {
  const buffer = getOrCreateDevServerTerminalBufferState(store, scriptId);
  const trimmedChunks = trimDevServerTerminalChunks(terminalChunks);

  buffer.entries.length = 0;
  buffer.head = 0;
  buffer.size = 0;
  buffer.lastSequence = null;
  buffer.firstSnapshotSequence = null;
  buffer.lastSnapshotSequence = null;
  buffer.resetToken += 1;
  buffer.snapshotEntryCount = 0;

  for (const terminalChunk of trimmedChunks) {
    appendDevServerTerminalChunk(store, terminalChunk);
  }

  buffer.firstSnapshotSequence = trimmedChunks[0]?.sequence ?? null;
  buffer.lastSnapshotSequence = trimmedChunks.at(-1)?.sequence ?? null;
  buffer.snapshotEntryCount = trimmedChunks.length;
};

export const syncDevServerTerminalBufferStore = (
  store: DevServerTerminalBufferStore,
  state: DevServerGroupState | null,
): void => {
  if (!state) {
    store.clear();
    return;
  }

  const nextScriptIds = new Set(state.scripts.map((script) => script.scriptId));
  for (const scriptId of store.keys()) {
    if (!nextScriptIds.has(scriptId)) {
      store.delete(scriptId);
    }
  }

  for (const script of state.scripts) {
    replaceDevServerTerminalBuffer(store, script.scriptId, script.bufferedTerminalChunks);
  }
};

export const getDevServerTerminalBuffer = (
  store: DevServerTerminalBufferStore,
  scriptId: string | null,
): AgentStudioDevServerTerminalBuffer | null => {
  if (!scriptId) {
    return null;
  }

  const buffer = store.get(scriptId);
  if (!buffer) {
    return null;
  }

  return {
    entries: Array.from({ length: buffer.size }, (_, offset) => {
      const entry =
        buffer.entries[(buffer.head + offset) % MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS];
      if (!entry) {
        throw new Error(`Missing dev server terminal chunk at logical offset ${offset}.`);
      }

      return entry;
    }),
    firstSnapshotSequence: buffer.firstSnapshotSequence,
    lastSequence: buffer.lastSequence,
    lastSnapshotSequence: buffer.lastSnapshotSequence,
    resetToken: buffer.resetToken,
    snapshotEntryCount: buffer.snapshotEntryCount,
  };
};

export const shouldReplaceDevServerTerminalBufferFromScript = (
  currentBuffer: AgentStudioDevServerTerminalBuffer | null,
  script: DevServerScriptState,
  force = false,
): boolean => {
  if (force || currentBuffer === null) {
    return true;
  }

  const nextChunks = trimDevServerTerminalChunks(script.bufferedTerminalChunks);
  const currentWindow = readBufferedSequenceWindow(currentBuffer.entries);
  const nextWindow = readBufferedSequenceWindow(nextChunks);
  const currentSnapshotEntryCount = currentBuffer.snapshotEntryCount ?? currentWindow.count;
  const currentFirstSnapshotSequence =
    currentBuffer.firstSnapshotSequence ?? currentWindow.firstSequence;
  const currentLastSnapshotSequence =
    currentBuffer.lastSnapshotSequence ?? currentWindow.lastSequence;
  const currentBufferMirrorsSnapshot =
    currentWindow.count === currentSnapshotEntryCount &&
    currentWindow.firstSequence === currentFirstSnapshotSequence &&
    currentWindow.lastSequence === currentLastSnapshotSequence;

  if (nextWindow.lastSequence === null) {
    return currentWindow.count > 0 && currentBufferMirrorsSnapshot;
  }

  if (currentWindow.lastSequence === null) {
    return true;
  }

  if (nextWindow.lastSequence > currentWindow.lastSequence) {
    return true;
  }

  if (nextWindow.lastSequence < currentWindow.lastSequence) {
    return false;
  }

  return (
    nextWindow.count !== currentWindow.count ||
    nextWindow.firstSequence !== currentWindow.firstSequence
  );
};

export const getLatestBufferedTerminalSequence = (script: DevServerScriptState): number | null => {
  const lastChunk = script.bufferedTerminalChunks.at(-1);
  return lastChunk ? lastChunk.sequence : null;
};
