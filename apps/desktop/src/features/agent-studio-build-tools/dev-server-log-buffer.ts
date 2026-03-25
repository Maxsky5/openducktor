import type {
  DevServerGroupState,
  DevServerLogLine,
  DevServerScriptState,
} from "@openducktor/contracts";

const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `(?:${ESC}\\[[0-?]*[ -/]*[@-~])|(?:${CSI}[0-?]*[ -/]*[@-~])|(?:\\uFFFD\\[[0-9;]*[A-Za-z])`,
  "g",
);

export const MAX_BUFFERED_DEV_SERVER_LOG_LINES = 2_000;

export type AgentStudioDevServerLogEntry = {
  id: string;
  timestamp: string;
  stream: DevServerScriptState["bufferedLogLines"][number]["stream"];
  text: string;
};

export type AgentStudioDevServerLogBuffer = {
  entries: readonly AgentStudioDevServerLogEntry[];
};

type DevServerLogBufferState = {
  entries: AgentStudioDevServerLogEntry[];
  head: number;
  size: number;
  nextSequence: number;
};

export type DevServerLogBufferStore = Map<string, DevServerLogBufferState>;

export const trimDevServerLogLines = (lines: DevServerLogLine[]): DevServerLogLine[] => {
  if (lines.length <= MAX_BUFFERED_DEV_SERVER_LOG_LINES) {
    return lines;
  }

  return lines.slice(-MAX_BUFFERED_DEV_SERVER_LOG_LINES);
};

const sanitizeLogText = (text: string): string => text.replace(ANSI_ESCAPE_SEQUENCE, "");

const createDevServerLogBufferState = (): DevServerLogBufferState => ({
  entries: [],
  head: 0,
  size: 0,
  nextSequence: 0,
});

const getOrCreateDevServerLogBufferState = (
  store: DevServerLogBufferStore,
  scriptId: string,
): DevServerLogBufferState => {
  const existingBuffer = store.get(scriptId);
  if (existingBuffer) {
    return existingBuffer;
  }

  const nextBuffer = createDevServerLogBufferState();
  store.set(scriptId, nextBuffer);
  return nextBuffer;
};

export const createDevServerLogBufferStore = (): DevServerLogBufferStore => new Map();

export const appendDevServerLogLine = (
  store: DevServerLogBufferStore,
  logLine: DevServerLogLine,
): void => {
  const buffer = getOrCreateDevServerLogBufferState(store, logLine.scriptId);
  const entry: AgentStudioDevServerLogEntry = {
    id: `${logLine.scriptId}:${buffer.nextSequence}`,
    timestamp: logLine.timestamp,
    stream: logLine.stream,
    text: sanitizeLogText(logLine.text),
  };
  buffer.nextSequence += 1;

  if (buffer.size < MAX_BUFFERED_DEV_SERVER_LOG_LINES) {
    const insertionIndex = (buffer.head + buffer.size) % MAX_BUFFERED_DEV_SERVER_LOG_LINES;
    buffer.entries[insertionIndex] = entry;
    buffer.size += 1;
    return;
  }

  buffer.entries[buffer.head] = entry;
  buffer.head = (buffer.head + 1) % MAX_BUFFERED_DEV_SERVER_LOG_LINES;
};

export const replaceDevServerLogBuffer = (
  store: DevServerLogBufferStore,
  scriptId: string,
  logLines: DevServerLogLine[],
): void => {
  const buffer = getOrCreateDevServerLogBufferState(store, scriptId);
  buffer.entries.length = 0;
  buffer.head = 0;
  buffer.size = 0;
  buffer.nextSequence = 0;

  for (const logLine of trimDevServerLogLines(logLines)) {
    appendDevServerLogLine(store, logLine);
  }
};

export const syncDevServerLogBufferStore = (
  store: DevServerLogBufferStore,
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
    replaceDevServerLogBuffer(store, script.scriptId, script.bufferedLogLines);
  }
};

export const getDevServerLogBuffer = (
  store: DevServerLogBufferStore,
  scriptId: string | null,
): AgentStudioDevServerLogBuffer | null => {
  if (!scriptId) {
    return null;
  }

  const buffer = store.get(scriptId);
  if (!buffer) {
    return null;
  }

  return {
    entries: Array.from({ length: buffer.size }, (_, offset) => {
      const entry = buffer.entries[(buffer.head + offset) % MAX_BUFFERED_DEV_SERVER_LOG_LINES];
      if (!entry) {
        throw new Error(`Missing dev server log entry at logical offset ${offset}.`);
      }

      return entry;
    }),
  };
};

export const getDevServerLogEntryAt = (
  buffer: AgentStudioDevServerLogBuffer,
  offset: number,
): AgentStudioDevServerLogEntry | null => {
  if (offset < 0 || offset >= buffer.entries.length) {
    return null;
  }

  return buffer.entries[offset] ?? null;
};
