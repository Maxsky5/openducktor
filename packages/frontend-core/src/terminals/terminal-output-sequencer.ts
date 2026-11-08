export const createTerminalOutputSequencer = ({
  write,
  onConsumed,
  onHydrated = () => undefined,
}: {
  write: (payload: Uint8Array, parsed: () => void) => void;
  onConsumed: (sequenceEnd: number) => void;
  onHydrated?: () => void;
}) => {
  let consumedSequence = 0;
  let submittedSequence = 0;
  let snapshotBoundary: number | null = null;
  let hydrated = false;
  let disposed = false;
  let epoch = 0;
  let lastWrite = Promise.resolve();
  let restoreBarrier: Promise<void> | null = null;
  let failure: Error | null = null;
  let pendingAck: { sequence: number; epoch: number } | null = null;

  const fail = (cause: unknown): Error => {
    failure = cause instanceof Error ? cause : new Error(String(cause));
    return failure;
  };
  const revealHydratedTerminal = (): void => {
    if (hydrated || snapshotBoundary === null || consumedSequence < snapshotBoundary) return;
    hydrated = true;
    onHydrated();
  };
  const acknowledge = (): void => {
    const scheduled = pendingAck !== null;
    pendingAck = { sequence: consumedSequence, epoch };
    if (scheduled) return;
    // xterm parses many chunks in one turn. Send one ACK for the parsed byte range.
    queueMicrotask(() => {
      const ack = pendingAck;
      pendingAck = null;
      if (!disposed && !failure && ack?.epoch === epoch) onConsumed(ack.sequence);
    });
  };

  /**
   * Ends the current attachment. Output that xterm parsed already sends its ACK now, before the
   * detach frame. Output that xterm parses later sends no ACK, because the host forgets the
   * attachment. The next attachment replays from the last ACK, and the sequencer acknowledges the
   * bytes that xterm has already.
   */
  const detach = (): void => {
    const ack = pendingAck;
    pendingAck = null;
    if (!disposed && !failure && ack?.epoch === epoch) onConsumed(ack.sequence);
    epoch += 1;
  };

  const submit = (
    frame: { sequenceStart: number; sequenceEnd: number },
    payload: Uint8Array,
    writeEpoch: number,
  ): Promise<void> => {
    if (disposed || writeEpoch !== epoch) return Promise.resolve();
    if (failure) return Promise.reject(failure);
    if (frame.sequenceEnd <= submittedSequence) {
      // xterm has these bytes from an earlier attachment. Acknowledge them after xterm parses them.
      return lastWrite.then(() => {
        if (disposed || writeEpoch !== epoch || failure) return;
        if (frame.sequenceEnd <= consumedSequence) return;
        consumedSequence = frame.sequenceEnd;
        acknowledge();
      });
    }
    if (frame.sequenceStart > submittedSequence) {
      return Promise.reject(
        fail(
          new Error("Terminal output has a byte gap. Close this tab and create a new terminal."),
        ),
      );
    }
    const remainingPayload = payload.subarray(submittedSequence - frame.sequenceStart);
    submittedSequence = frame.sequenceEnd;
    const completed = Promise.withResolvers<void>();
    lastWrite = completed.promise;
    try {
      // xterm owns the ordered, time-sliced write queue. Do not wait between chunks.
      write(remainingPayload, () => {
        try {
          if (!disposed && writeEpoch === epoch && !failure) {
            consumedSequence = frame.sequenceEnd;
            acknowledge();
            revealHydratedTerminal();
          }
          completed.resolve();
        } catch (cause) {
          completed.reject(fail(cause));
        }
      });
    } catch (cause) {
      completed.reject(fail(cause));
    }
    return completed.promise;
  };

  return {
    setSnapshotBoundary(sequenceEnd: number): void {
      snapshotBoundary = sequenceEnd;
      if (!disposed) revealHydratedTerminal();
    },
    enqueue(
      frame: { sequenceStart: number; sequenceEnd: number },
      payload: Uint8Array,
    ): Promise<void> {
      const writeEpoch = epoch;
      return restoreBarrier
        ? restoreBarrier.then(() => submit(frame, payload, writeEpoch))
        : submit(frame, payload, writeEpoch);
    },
    restore(
      sequence: number,
      payload: Uint8Array,
      prepare: () => void,
      finish: (completed: boolean) => void,
    ): Promise<void> {
      const restoreEpoch = ++epoch;
      submittedSequence = sequence;
      const restored = lastWrite
        .then(async () => {
          // A detach or a later restore can replace this restore before it starts. The caller
          // still gets one finish call, so it can admit input again.
          let completed = false;
          try {
            if (disposed || restoreEpoch !== epoch) return;
            prepare();
            await new Promise<void>((resolve) => write(payload, resolve));
            completed = !disposed && restoreEpoch === epoch;
          } finally {
            if (!disposed) finish(completed);
          }
          if (!completed) return;
          consumedSequence = sequence;
          acknowledge();
          revealHydratedTerminal();
        })
        .catch((cause) => {
          throw fail(cause);
        })
        .finally(() => {
          if (restoreBarrier === restored) restoreBarrier = null;
        });
      restoreBarrier = restored;
      lastWrite = restored;
      return restored;
    },
    detach,
    dispose(): void {
      disposed = true;
      detach();
    },
  };
};
