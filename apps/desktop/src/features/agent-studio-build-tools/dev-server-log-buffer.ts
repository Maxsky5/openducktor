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
  resetToken: number;
};

type DevServerTerminalBufferState = {
  entries: AgentStudioDevServerTerminalChunkEntry[];
  head: number;
  size: number;
  lastSequence: number | null;
  resetToken: number;
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

const createDevServerTerminalBufferState = (): DevServerTerminalBufferState => ({
  entries: [],
  head: 0,
  size: 0,
  lastSequence: null,
  resetToken: 0,
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
  buffer.resetToken += 1;

  for (const terminalChunk of trimmedChunks) {
    appendDevServerTerminalChunk(store, terminalChunk);
  }
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
    lastSequence: buffer.lastSequence,
    resetToken: buffer.resetToken,
  };
};

export const getLatestBufferedTerminalSequence = (script: DevServerScriptState): number | null => {
  const lastChunk = script.bufferedTerminalChunks.at(-1);
  return lastChunk ? lastChunk.sequence : null;
};
