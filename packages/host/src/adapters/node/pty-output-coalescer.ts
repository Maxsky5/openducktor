/** Output within this time after a delivery joins the next delivery: one frame at 120 Hz. */
export const PTY_OUTPUT_WINDOW_MS = 8;

/**
 * Waiting output of this size goes out at once. One delivery stays near the read size of
 * node-pty, so host backpressure can pause the PTY during the window.
 */
export const PTY_OUTPUT_MAX_BYTES = 64 * 1024;

type Schedule = (run: () => void, delayMs: number) => () => void;

const scheduleTimeout: Schedule = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

/**
 * Joins PTY output into fewer deliveries. Each delivery costs a frame, a parse, and an
 * acknowledgement in every client, so a program that writes line by line costs one delivery per
 * frame. Output after a quiet period, such as the echo of a key, goes out at once. See
 * docs/interactive-terminal-architecture.md.
 */
export const createPtyOutputCoalescer = ({
  deliver,
  now = () => performance.now(),
  schedule = scheduleTimeout,
}: {
  deliver: (data: Uint8Array) => void;
  now?: () => number;
  schedule?: Schedule;
}) => {
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let cancelTimer: (() => void) | null = null;
  let lastDeliveryAt = Number.NEGATIVE_INFINITY;

  const flush = (): void => {
    cancelTimer?.();
    cancelTimer = null;
    if (pending.length === 0) return;
    // One copy joins the chunks and leaves no view into the pooled buffers of node-pty.
    const data = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const chunk of pending) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    pending = [];
    pendingBytes = 0;
    lastDeliveryAt = now();
    deliver(data);
  };

  return {
    push(chunk: Uint8Array): void {
      pending.push(chunk);
      pendingBytes += chunk.byteLength;
      if (pendingBytes >= PTY_OUTPUT_MAX_BYTES) {
        flush();
        return;
      }
      if (cancelTimer !== null) return;
      const wait = lastDeliveryAt + PTY_OUTPUT_WINDOW_MS - now();
      if (wait <= 0) {
        flush();
        return;
      }
      cancelTimer = schedule(flush, wait);
    },
    /** Sends the waiting output at once, as before the exit of the PTY. */
    flush,
  };
};
