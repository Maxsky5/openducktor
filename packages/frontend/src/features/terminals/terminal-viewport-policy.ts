import type {
  TerminalFailure,
  TerminalLifecycle,
  TerminalServerMessage,
} from "@openducktor/contracts";

export const createTerminalViewportActivator = ({
  fit,
  scrollToBottom,
  refresh,
  readRows,
}: {
  fit: () => void;
  scrollToBottom: () => void;
  refresh: (start: number, end: number) => void;
  readRows: () => number;
}): ((focus: (() => void) | null) => void) => {
  let hasBeenRevealed = false;
  return (focus): void => {
    fit();
    if (!hasBeenRevealed) {
      scrollToBottom();
      hasBeenRevealed = true;
    }
    refresh(0, Math.max(0, readRows() - 1));
    focus?.();
  };
};

export const createTerminalInputSequencer = ({
  isActive,
  writeInput,
  reportFailure,
}: {
  isActive: () => boolean;
  writeInput: (data: Uint8Array) => Promise<void>;
  reportFailure: (cause: unknown) => void;
}) => {
  let inputQueue = Promise.resolve();
  return (operation: () => Uint8Array | Promise<Uint8Array>): Promise<void> => {
    inputQueue = inputQueue
      .then(async () => {
        if (!isActive()) return;
        const data = await operation();
        if (!isActive()) return;
        await writeInput(data);
      })
      .catch((cause) => reportFailure(cause));
    return inputQueue;
  };
};

export const createLatestResizeScheduler = (
  send: (columns: number, rows: number) => void,
  schedule: (callback: () => void) => void = queueMicrotask,
) => {
  type PendingResize = { columns: number; rows: number };
  let pending: PendingResize | null = null;
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    const grid = pending;
    pending = null;
    if (grid) send(grid.columns, grid.rows);
  };
  return {
    flush,
    schedule(columns: number, rows: number): void {
      pending = { columns, rows };
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
  };
};

export const createLiveTerminalFitScheduler = ({
  fit,
  isActive,
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (frameId) => cancelAnimationFrame(frameId),
}: {
  fit: () => void;
  isActive: () => boolean;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (frameId: number) => void;
}) => {
  let frameId: number | null = null;
  let lastFitTime = -Infinity;
  const runFrame: FrameRequestCallback = (time) => {
    frameId = null;
    if (!isActive()) return;
    // Reflow retained rows at most ten times per second during a continuous drag.
    if (time - lastFitTime < 100) {
      frameId = requestFrame(runFrame);
      return;
    }
    lastFitTime = time;
    fit();
  };
  return {
    schedule(): void {
      if (!isActive() || frameId !== null) return;
      frameId = requestFrame(runFrame);
    },
    flush(): void {
      if (frameId === null) return;
      cancelFrame(frameId);
      frameId = null;
      if (isActive()) fit();
    },
    dispose(): void {
      if (frameId === null) return;
      cancelFrame(frameId);
      frameId = null;
    },
  };
};

/** The exit status of a terminal process. A clean exit is not a failure. */
export type TerminalExitNotice = { text: string; isFailure: boolean };

export const handleTerminalMetadataFrame = (
  message: TerminalServerMessage,
  handlers: {
    onAttention: (message: string | null) => void;
    onLifecycle: (lifecycle: TerminalLifecycle, exit: TerminalExitNotice | null) => void;
    onTitle: (title: string) => void;
    onForgotten: (message: string, failure: TerminalFailure | null) => void;
    onFailure: (message: string) => void;
  },
): message is Exclude<TerminalServerMessage, { type: "output" | "screen_restore" }> => {
  if (message.type === "snapshot") {
    handlers.onLifecycle(message.lifecycle, null);
    handlers.onTitle(message.title);
    return true;
  }
  if (message.type === "title") {
    handlers.onTitle(message.title);
    return true;
  }
  if (message.type === "output_overflow") {
    handlers.onAttention("Output overflow stopped this terminal.");
    return true;
  }
  if (message.type === "lifecycle") {
    let exit: TerminalExitNotice | null = null;
    if (message.lifecycle === "exited") {
      const signalText = message.signal ? ` (${message.signal})` : "";
      exit = {
        text: `Exited with code ${message.exitCode ?? "unknown"}${signalText}.`,
        isFailure: message.exitCode !== 0 || Boolean(message.signal),
      };
    }
    handlers.onLifecycle(message.lifecycle, exit);
    return true;
  }
  if (message.type === "terminal_forgotten") {
    handlers.onForgotten("This terminal is no longer available from the host.", null);
    return true;
  }
  if (message.type === "protocol_error") {
    if (message.failure.code === "terminal_forgotten") {
      handlers.onForgotten(message.failure.message, message.failure);
      return true;
    }
    handlers.onFailure(message.failure.message);
    return true;
  }
  return message.type !== "output" && message.type !== "screen_restore";
};
