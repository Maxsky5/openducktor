import type { TerminalServerMessage } from "@openducktor/contracts";

export type TerminalFrameListener = (message: TerminalServerMessage, payload: Uint8Array) => void;

type TerminalChannel = {
  listeners: Set<TerminalFrameListener>;
  consumedSequence: number | null;
  operationQueue: Promise<void> | null;
  isClosing: boolean;
  discardQueuedOperations: boolean;
};

export const createTerminalTransportChannelRegistry = () => {
  const channels = new Map<string, TerminalChannel>();

  const getOrCreate = (terminalId: string): TerminalChannel => {
    const current = channels.get(terminalId);
    if (current) return current;
    const channel: TerminalChannel = {
      listeners: new Set(),
      consumedSequence: null,
      operationQueue: null,
      isClosing: false,
      discardQueuedOperations: false,
    };
    channels.set(terminalId, channel);
    return channel;
  };

  const forgetIfUnused = (terminalId: string, channel: TerminalChannel): void => {
    if (
      channel.listeners.size === 0 &&
      channel.consumedSequence === null &&
      channel.operationQueue === null &&
      !channel.isClosing &&
      !channel.discardQueuedOperations
    ) {
      channels.delete(terminalId);
    }
  };

  return {
    listeners(terminalId: string): ReadonlySet<TerminalFrameListener> {
      return channels.get(terminalId)?.listeners ?? new Set();
    },
    activeTerminalIds(): string[] {
      const terminalIds: string[] = [];
      for (const [terminalId, channel] of channels) {
        if (channel.listeners.size > 0) terminalIds.push(terminalId);
      }
      return terminalIds;
    },
    addListener(terminalId: string, listener: TerminalFrameListener): boolean {
      const channel = getOrCreate(terminalId);
      const isFirstListener = channel.listeners.size === 0;
      channel.listeners.add(listener);
      return isFirstListener;
    },
    removeListener(
      terminalId: string,
      listener: TerminalFrameListener,
    ): { lastListenerRemoved: boolean; wasClosing: boolean } {
      const channel = channels.get(terminalId);
      if (!channel) return { lastListenerRemoved: false, wasClosing: false };
      channel.listeners.delete(listener);
      if (channel.listeners.size > 0) return { lastListenerRemoved: false, wasClosing: false };
      const wasClosing = channel.isClosing;
      channel.isClosing = false;
      if (!channel.operationQueue) channel.discardQueuedOperations = false;
      forgetIfUnused(terminalId, channel);
      return { lastListenerRemoved: true, wasClosing };
    },
    lastConsumedSequence(terminalId: string): number | null {
      return channels.get(terminalId)?.consumedSequence ?? null;
    },
    advanceConsumedSequence(terminalId: string, sequenceEnd: number): boolean {
      const channel = getOrCreate(terminalId);
      if (channel.consumedSequence !== null && sequenceEnd <= channel.consumedSequence)
        return false;
      channel.consumedSequence = sequenceEnd;
      return true;
    },
    enqueue(terminalId: string, operation: () => Promise<void>): Promise<void> {
      const channel = getOrCreate(terminalId);
      const run = (): Promise<void> =>
        channel.discardQueuedOperations ? Promise.resolve() : operation();
      const pending = channel.operationQueue ? channel.operationQueue.then(run) : run();
      channel.operationQueue = pending;
      const clearCompletedOperation = (): void => {
        if (channel.operationQueue !== pending) return;
        channel.operationQueue = null;
        if (channel.listeners.size === 0) channel.discardQueuedOperations = false;
        forgetIfUnused(terminalId, channel);
      };
      void pending.then(clearCompletedOperation, clearCompletedOperation);
      return pending;
    },
    beginClose(terminalId: string): void {
      getOrCreate(terminalId).isClosing = true;
    },
    cancelClose(terminalId: string): void {
      const channel = channels.get(terminalId);
      if (!channel) return;
      channel.isClosing = false;
      forgetIfUnused(terminalId, channel);
    },
    completeClose(terminalId: string): void {
      const channel = getOrCreate(terminalId);
      channel.isClosing = channel.listeners.size > 0;
      channel.consumedSequence = null;
      channel.discardQueuedOperations = channel.operationQueue !== null;
      forgetIfUnused(terminalId, channel);
    },
    releaseEmulator(terminalId: string): void {
      const channel = channels.get(terminalId);
      if (!channel || channel.listeners.size > 1) return;
      channel.consumedSequence = null;
      forgetIfUnused(terminalId, channel);
    },
    clear(): void {
      channels.clear();
    },
  };
};
