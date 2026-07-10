import type {
  DevServerGroupState,
  DevServerRunIdentity,
  DevServerScriptState,
  DevServerTerminalChunk,
} from "@openducktor/contracts";
import {
  areDevServerRunIdentitiesEqual,
  canApplyDevServerGroupState,
  canApplyDevServerRunIdentityToStore,
  compareDevServerRunIdentity,
} from "./dev-server-run-ownership";

export const MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS = 2_000;

export type AgentStudioDevServerTerminalChunkEntry = DevServerTerminalChunk;

export type AgentStudioDevServerTerminalBuffer = {
  entries: readonly AgentStudioDevServerTerminalChunkEntry[];
  lastSequence: number | null;
  resetToken: number;
};

type DevServerTerminalSequenceWindow = {
  count: number;
  firstSequence: number | null;
  lastSequence: number | null;
};

export type DevServerTerminalBufferReplacementContext = {
  current: DevServerTerminalSequenceWindow;
  currentEntries: readonly AgentStudioDevServerTerminalChunkEntry[];
  runIdentity: DevServerRunIdentity | null;
  snapshot: DevServerTerminalSequenceWindow;
};

export type DevServerTerminalBufferReplacement = {
  runIdentity: DevServerRunIdentity | null;
  snapshotWindow: DevServerTerminalSequenceWindow;
  terminalChunks: readonly DevServerTerminalChunk[];
};

type DevServerTerminalBufferState = {
  entries: AgentStudioDevServerTerminalChunkEntry[];
  firstSnapshotSequence: number | null;
  head: number;
  lastSnapshotSequence: number | null;
  size: number;
  lastSequence: number | null;
  resetToken: number;
  runIdentity: DevServerRunIdentity | null;
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
): DevServerTerminalSequenceWindow => {
  return {
    count: chunks.length,
    firstSequence: chunks[0]?.sequence ?? null,
    lastSequence: chunks.at(-1)?.sequence ?? null,
  };
};

const readCurrentBufferWindow = (
  buffer: DevServerTerminalBufferState,
): DevServerTerminalSequenceWindow => {
  return {
    count: buffer.size,
    firstSequence:
      buffer.size === 0
        ? null
        : (buffer.entries[buffer.head % MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS]?.sequence ?? null),
    lastSequence: buffer.lastSequence,
  };
};

const readCurrentBufferEntries = (
  buffer: DevServerTerminalBufferState,
): AgentStudioDevServerTerminalChunkEntry[] => {
  return Array.from({ length: buffer.size }, (_, offset) => {
    const entry = buffer.entries[(buffer.head + offset) % MAX_BUFFERED_DEV_SERVER_TERMINAL_CHUNKS];
    if (!entry) {
      throw new Error(`Missing dev server terminal chunk at logical offset ${offset}.`);
    }

    return entry;
  });
};

const EMPTY_DEV_SERVER_TERMINAL_SEQUENCE_WINDOW: DevServerTerminalSequenceWindow = {
  count: 0,
  firstSequence: null,
  lastSequence: null,
};

const readSnapshotBufferWindow = (
  buffer: DevServerTerminalBufferState,
): DevServerTerminalSequenceWindow => {
  return {
    count: buffer.snapshotEntryCount,
    firstSequence: buffer.firstSnapshotSequence,
    lastSequence: buffer.lastSnapshotSequence,
  };
};

const areSequenceWindowsEqual = (
  left: DevServerTerminalSequenceWindow,
  right: DevServerTerminalSequenceWindow,
): boolean =>
  left.count === right.count &&
  left.firstSequence === right.firstSequence &&
  left.lastSequence === right.lastSequence;

const areTerminalChunksEqual = (
  left: readonly DevServerTerminalChunk[],
  right: readonly AgentStudioDevServerTerminalChunkEntry[],
): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((chunk, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      chunk.scriptId === other.scriptId &&
      areDevServerRunIdentitiesEqual(chunk.runIdentity, other.runIdentity) &&
      chunk.sequence === other.sequence &&
      chunk.data === other.data &&
      chunk.timestamp === other.timestamp
    );
  });
};

const createDevServerTerminalBufferState = (): DevServerTerminalBufferState => ({
  entries: [],
  firstSnapshotSequence: null,
  head: 0,
  lastSnapshotSequence: null,
  size: 0,
  lastSequence: null,
  resetToken: 0,
  runIdentity: null,
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
): boolean => {
  const nextRunIdentity = terminalChunk.runIdentity;
  if (!canApplyDevServerRunIdentityToStore(store, nextRunIdentity)) {
    return false;
  }

  let buffer = getOrCreateDevServerTerminalBufferState(store, terminalChunk.scriptId);
  if (!areDevServerRunIdentitiesEqual(buffer.runIdentity, nextRunIdentity)) {
    const runOrder = compareDevServerRunIdentity(buffer.runIdentity, nextRunIdentity);
    if (runOrder !== "newer") {
      return false;
    }
    replaceDevServerTerminalBuffer(store, terminalChunk.scriptId, [], nextRunIdentity);
    buffer = getOrCreateDevServerTerminalBufferState(store, terminalChunk.scriptId);
  } else {
    buffer.runIdentity = nextRunIdentity;
  }

  if (buffer.lastSequence !== null && terminalChunk.sequence <= buffer.lastSequence) {
    return false;
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
  return true;
};

export const replaceDevServerTerminalBuffer = (
  store: DevServerTerminalBufferStore,
  scriptId: string,
  terminalChunks: DevServerTerminalChunk[],
  runIdentity: DevServerRunIdentity | null = terminalChunks[0]?.runIdentity ?? null,
): void => {
  const buffer = getOrCreateDevServerTerminalBufferState(store, scriptId);
  const trimmedChunks = trimDevServerTerminalChunks(terminalChunks);
  const shouldResetTerminal = buffer.size > 0 || trimmedChunks.length > 0;

  buffer.entries.length = 0;
  buffer.head = 0;
  buffer.size = 0;
  buffer.lastSequence = null;
  buffer.firstSnapshotSequence = null;
  buffer.lastSnapshotSequence = null;
  buffer.runIdentity = runIdentity;
  if (shouldResetTerminal) {
    buffer.resetToken += 1;
  }
  buffer.snapshotEntryCount = 0;

  for (const terminalChunk of trimmedChunks) {
    appendDevServerTerminalChunk(store, terminalChunk);
  }

  const snapshotWindow = readCurrentBufferWindow(buffer);
  buffer.firstSnapshotSequence = snapshotWindow.firstSequence;
  buffer.lastSnapshotSequence = snapshotWindow.lastSequence;
  buffer.snapshotEntryCount = snapshotWindow.count;
};

export const applyDevServerTerminalBufferReplacement = (
  store: DevServerTerminalBufferStore,
  scriptId: string,
  replacement: DevServerTerminalBufferReplacement,
): void => {
  replaceDevServerTerminalBuffer(
    store,
    scriptId,
    [...replacement.terminalChunks],
    replacement.runIdentity,
  );

  const buffer = getOrCreateDevServerTerminalBufferState(store, scriptId);
  buffer.firstSnapshotSequence = replacement.snapshotWindow.firstSequence;
  buffer.lastSnapshotSequence = replacement.snapshotWindow.lastSequence;
  buffer.runIdentity = replacement.runIdentity;
  buffer.snapshotEntryCount = replacement.snapshotWindow.count;
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
    replaceDevServerTerminalBuffer(
      store,
      script.scriptId,
      script.bufferedTerminalChunks,
      script.runIdentity,
    );
  }
};

export const getDevServerTerminalBufferReplacementContext = (
  store: DevServerTerminalBufferStore,
  scriptId: string,
): DevServerTerminalBufferReplacementContext | null => {
  const buffer = store.get(scriptId);
  if (!buffer) {
    return null;
  }

  return {
    current: readCurrentBufferWindow(buffer),
    currentEntries: readCurrentBufferEntries(buffer),
    runIdentity: buffer.runIdentity,
    snapshot: readSnapshotBufferWindow(buffer),
  };
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
    entries: readCurrentBufferEntries(buffer),
    lastSequence: buffer.lastSequence,
    resetToken: buffer.resetToken,
  };
};

const shouldMergeSameRunReplayPrefix = (
  currentContext: DevServerTerminalBufferReplacementContext,
  nextRunIdentity: DevServerRunIdentity | null,
  nextWindow: DevServerTerminalSequenceWindow,
): boolean => {
  if (
    currentContext.runIdentity === null ||
    nextRunIdentity === null ||
    !areDevServerRunIdentitiesEqual(currentContext.runIdentity, nextRunIdentity)
  ) {
    return false;
  }

  if (
    nextWindow.firstSequence === null ||
    nextWindow.lastSequence === null ||
    currentContext.current.firstSequence === null
  ) {
    return false;
  }

  return nextWindow.firstSequence <= currentContext.current.firstSequence;
};

const mergeReplayPrefixWithCurrentEntries = (
  nextChunks: readonly DevServerTerminalChunk[],
  currentEntries: readonly AgentStudioDevServerTerminalChunkEntry[],
): DevServerTerminalChunk[] => {
  const chunksBySequence = new Map<number, DevServerTerminalChunk>();
  for (const chunk of nextChunks) {
    chunksBySequence.set(chunk.sequence, chunk);
  }
  for (const chunk of currentEntries) {
    chunksBySequence.set(chunk.sequence, chunk);
  }

  return trimDevServerTerminalChunks(
    [...chunksBySequence.values()].sort((left, right) => left.sequence - right.sequence),
  );
};

const createDevServerTerminalBufferReplacement = (
  currentContext: DevServerTerminalBufferReplacementContext | null,
  snapshotWindow: DevServerTerminalSequenceWindow,
  terminalChunks: readonly DevServerTerminalChunk[],
  runIdentity: DevServerRunIdentity | null,
): DevServerTerminalBufferReplacement | null => {
  if (
    currentContext &&
    areDevServerRunIdentitiesEqual(currentContext.runIdentity, runIdentity) &&
    areSequenceWindowsEqual(currentContext.snapshot, snapshotWindow) &&
    areTerminalChunksEqual(terminalChunks, currentContext.currentEntries)
  ) {
    return null;
  }

  return {
    runIdentity,
    snapshotWindow,
    terminalChunks,
  };
};

export const getDevServerTerminalBufferReplacement = (
  currentContext: DevServerTerminalBufferReplacementContext | null,
  script: DevServerScriptState,
): DevServerTerminalBufferReplacement | null => {
  const nextChunks = trimDevServerTerminalChunks(script.bufferedTerminalChunks);
  const nextWindow = readBufferedSequenceWindow(nextChunks);
  const nextRunIdentity = script.runIdentity;

  if (currentContext === null) {
    return createDevServerTerminalBufferReplacement(
      currentContext,
      nextWindow,
      nextChunks,
      nextRunIdentity,
    );
  }

  const runOrder = compareDevServerRunIdentity(currentContext.runIdentity, nextRunIdentity);
  if (runOrder === "older" || runOrder === "foreign") {
    return null;
  }
  if (runOrder === "newer") {
    return createDevServerTerminalBufferReplacement(
      currentContext,
      nextWindow,
      nextChunks,
      nextRunIdentity,
    );
  }

  const currentWindow = currentContext.current;
  const currentBufferMirrorsSnapshot =
    currentWindow.count === currentContext.snapshot.count &&
    currentWindow.firstSequence === currentContext.snapshot.firstSequence &&
    currentWindow.lastSequence === currentContext.snapshot.lastSequence;

  if (nextWindow.lastSequence === null) {
    if (currentWindow.count === 0 || currentContext.snapshot.lastSequence === null) {
      return null;
    }

    const snapshotLastSequence = currentContext.snapshot.lastSequence;
    const liveOnlyChunks = currentContext.currentEntries.filter(
      (chunk) => chunk.sequence > snapshotLastSequence,
    );
    if (liveOnlyChunks.length > 0) {
      return createDevServerTerminalBufferReplacement(
        currentContext,
        EMPTY_DEV_SERVER_TERMINAL_SEQUENCE_WINDOW,
        trimDevServerTerminalChunks([...liveOnlyChunks]),
        currentContext.runIdentity,
      );
    }

    if (!currentBufferMirrorsSnapshot) {
      return createDevServerTerminalBufferReplacement(
        currentContext,
        EMPTY_DEV_SERVER_TERMINAL_SEQUENCE_WINDOW,
        [],
        currentContext.runIdentity,
      );
    }

    return createDevServerTerminalBufferReplacement(
      currentContext,
      nextWindow,
      nextChunks,
      nextRunIdentity,
    );
  }

  if (currentWindow.lastSequence === null) {
    return createDevServerTerminalBufferReplacement(
      currentContext,
      nextWindow,
      nextChunks,
      nextRunIdentity,
    );
  }

  if (nextWindow.lastSequence > currentWindow.lastSequence) {
    return createDevServerTerminalBufferReplacement(
      currentContext,
      nextWindow,
      nextChunks,
      nextRunIdentity,
    );
  }

  if (nextWindow.lastSequence < currentWindow.lastSequence) {
    if (shouldMergeSameRunReplayPrefix(currentContext, nextRunIdentity, nextWindow)) {
      return createDevServerTerminalBufferReplacement(
        currentContext,
        nextWindow,
        mergeReplayPrefixWithCurrentEntries(nextChunks, currentContext.currentEntries),
        nextRunIdentity,
      );
    }

    return null;
  }

  if (
    nextWindow.count !== currentWindow.count ||
    nextWindow.firstSequence !== currentWindow.firstSequence ||
    !areDevServerRunIdentitiesEqual(nextRunIdentity, currentContext.runIdentity)
  ) {
    return createDevServerTerminalBufferReplacement(
      currentContext,
      nextWindow,
      nextChunks,
      nextRunIdentity,
    );
  }

  return null;
};

export const shouldReplaceDevServerTerminalBufferFromScript = (
  currentContext: DevServerTerminalBufferReplacementContext | null,
  script: DevServerScriptState,
): boolean => {
  return getDevServerTerminalBufferReplacement(currentContext, script) !== null;
};

export const reconcileDevServerTerminalBufferStore = (
  store: DevServerTerminalBufferStore,
  state: DevServerGroupState,
): boolean => {
  if (!canApplyDevServerGroupState(store, state)) {
    return false;
  }

  let didChange = false;
  const nextScriptIds = new Set(state.scripts.map((script) => script.scriptId));

  for (const scriptId of store.keys()) {
    if (nextScriptIds.has(scriptId)) {
      continue;
    }

    store.delete(scriptId);
    didChange = true;
  }

  for (const script of state.scripts) {
    const replacement = getDevServerTerminalBufferReplacement(
      getDevServerTerminalBufferReplacementContext(store, script.scriptId),
      script,
    );
    if (replacement === null) {
      continue;
    }

    applyDevServerTerminalBufferReplacement(store, script.scriptId, replacement);
    didChange = true;
  }

  return didChange;
};
