import type { TerminalLifecycle, TerminalServerMessage } from "@openducktor/contracts";

export type TerminalKeyAction =
  | "copy"
  | "interrupt"
  | "kill-to-line-start"
  | "line-end"
  | "line-start"
  | "next-word"
  | "paste"
  | "passthrough"
  | "previous-word";

const TERMINAL_INPUT_BY_KEY_ACTION: Partial<Record<TerminalKeyAction, readonly number[]>> = {
  interrupt: [3],
  "kill-to-line-start": [21],
  "line-end": [5],
  "line-start": [1],
  "next-word": [27, 102],
  "previous-word": [27, 98],
};

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

type TerminalKeyEventHandlerInput = {
  isMac: boolean;
  hasSelection: () => boolean;
  getSelection: () => string;
  writeClipboard: (text: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  enqueueInput: (operation: () => Uint8Array | Promise<Uint8Array>) => Promise<void>;
  reportFailure: (cause: unknown) => void;
};

export const resolveTerminalKeyAction = (
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey" | "type">,
  isMac: boolean,
  hasSelection: boolean,
): TerminalKeyAction => {
  if (event.type !== "keydown") return "passthrough";
  const key = event.key.toLowerCase();
  const copy =
    (isMac && event.metaKey && key === "c") ||
    (!isMac && event.ctrlKey && event.shiftKey && key === "c") ||
    (!isMac && event.ctrlKey && key === "c" && hasSelection);
  if (copy && hasSelection) return "copy";
  const paste =
    (isMac && event.metaKey && key === "v") ||
    (!isMac && event.ctrlKey && event.shiftKey && key === "v");
  if (paste) return "paste";
  if (event.ctrlKey && key === "c" && !hasSelection) return "interrupt";
  const commandOnly = isMac && event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
  if (commandOnly && key === "arrowleft") return "line-start";
  if (commandOnly && key === "arrowright") return "line-end";
  if (commandOnly && key === "backspace") return "kill-to-line-start";
  const optionOnly = isMac && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
  if (optionOnly && key === "arrowleft") return "previous-word";
  if (optionOnly && key === "arrowright") return "next-word";
  return "passthrough";
};

export const createTerminalKeyEventHandler = ({
  isMac,
  hasSelection,
  getSelection,
  writeClipboard,
  readClipboard,
  enqueueInput,
  reportFailure,
}: TerminalKeyEventHandlerInput) => {
  return (event: KeyboardEvent): boolean => {
    const action = resolveTerminalKeyAction(event, isMac, hasSelection());
    if (action === "copy") {
      void writeClipboard(getSelection()).catch(reportFailure);
      return false;
    }
    if (action === "paste") {
      void enqueueInput(() => readClipboard().then((text) => new TextEncoder().encode(text)));
      return false;
    }
    const input = TERMINAL_INPUT_BY_KEY_ACTION[action];
    if (input) {
      void enqueueInput(() => new Uint8Array(input));
      return false;
    }
    return true;
  };
};

export const createTerminalInputSequencer = ({
  writeInput,
  reportFailure,
}: {
  writeInput: (data: Uint8Array) => Promise<void>;
  reportFailure: (cause: unknown) => void;
}) => {
  let inputQueue = Promise.resolve();
  return (operation: () => Uint8Array | Promise<Uint8Array>): Promise<void> => {
    inputQueue = inputQueue
      .then(async () => writeInput(await operation()))
      .catch((cause) => reportFailure(cause));
    return inputQueue;
  };
};

export const createLatestResizeScheduler = (
  send: (columns: number, rows: number) => void,
  schedule: (callback: () => void) => void = queueMicrotask,
) => {
  let pending: { columns: number; rows: number } | null = null;
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

export const handleTerminalMetadataFrame = (
  message: TerminalServerMessage,
  handlers: {
    reset: () => void;
    onAttention: (message: string | null) => void;
    onLifecycle: (lifecycle: TerminalLifecycle, exitText: string | null) => void;
    onTitle: (title: string) => void;
    onForgotten: (message: string) => void;
    onFailure: (message: string) => void;
  },
): message is Exclude<TerminalServerMessage, { type: "output" }> => {
  if (message.type === "snapshot") {
    handlers.onLifecycle(message.lifecycle, null);
    handlers.onTitle(message.title);
    return true;
  }
  if (message.type === "title") {
    handlers.onTitle(message.title);
    return true;
  }
  if (message.type === "replay_gap") {
    handlers.reset();
    handlers.onAttention(
      `Incomplete replay: output ${message.missingSequenceStart}–${message.missingSequenceEnd} is unavailable.`,
    );
    return true;
  }
  if (message.type === "output_overflow") {
    handlers.onAttention("Output overflow stopped this terminal.");
    return true;
  }
  if (message.type === "lifecycle") {
    let exitText: string | null = null;
    if (message.lifecycle === "exited") {
      const signalText = message.signal ? ` (${message.signal})` : "";
      exitText = `Exited with code ${message.exitCode ?? "unknown"}${signalText}.`;
    }
    handlers.onLifecycle(message.lifecycle, exitText);
    return true;
  }
  if (message.type === "terminal_forgotten") {
    handlers.onForgotten("This terminal is no longer available from the host.");
    return true;
  }
  if (message.type === "protocol_error") {
    if (message.failure.code === "terminal_forgotten") {
      handlers.onForgotten(message.failure.message);
      return true;
    }
    handlers.onFailure(message.failure.message);
    return true;
  }
  return message.type !== "output";
};

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
  let snapshotBoundary: number | null = null;
  let hydrated = false;
  let epoch = 0;
  let queue = Promise.resolve();
  const revealHydratedTerminal = (): void => {
    if (hydrated || snapshotBoundary === null || consumedSequence < snapshotBoundary) return;
    hydrated = true;
    onHydrated();
  };
  return {
    setSnapshotBoundary(sequenceEnd: number): void {
      snapshotBoundary = sequenceEnd;
      revealHydratedTerminal();
    },
    enqueue(
      frame: { sequenceStart: number; sequenceEnd: number },
      payload: Uint8Array,
    ): Promise<void> {
      const writeEpoch = epoch;
      queue = queue.then(() => {
        if (writeEpoch !== epoch) return;
        if (frame.sequenceEnd <= consumedSequence) return;
        const consumedBytes = Math.max(0, consumedSequence - frame.sequenceStart);
        const remainingPayload = payload.subarray(Math.min(consumedBytes, payload.byteLength));
        return new Promise<void>((resolve) => {
          write(remainingPayload, () => {
            if (writeEpoch !== epoch) {
              resolve();
              return;
            }
            consumedSequence = Math.max(consumedSequence, frame.sequenceEnd);
            onConsumed(frame.sequenceEnd);
            revealHydratedTerminal();
            resolve();
          });
        });
      });
      return queue;
    },
    skipTo(sequence: number, reset: () => void): Promise<void> {
      epoch += 1;
      const resetEpoch = epoch;
      consumedSequence = Math.max(consumedSequence, sequence);
      queue = queue.then(() => {
        if (resetEpoch === epoch) {
          reset();
          revealHydratedTerminal();
        }
      });
      return queue;
    },
  };
};
