import type { TerminalLifecycle, TerminalServerMessage } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { encodeTerminalTextInput } from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";
import type { TerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import {
  createLatestResizeScheduler,
  createTerminalInputSequencer,
  handleTerminalMetadataFrame,
  type TerminalExitNotice,
  type TerminalFrameScheduler,
} from "@openducktor/frontend-core/terminals/terminal-viewport-policy";
import { isOutcomeUnknown } from "@openducktor/frontend-core/lib/command-outcome";
import { createTerminalPageBatcher } from "./terminal-page-batcher";
import type {
  TerminalPageInbound,
  TerminalPageOutbound,
} from "@/rich-content/isolated-page/terminal-page-messages";

/** The transport controller calls of one terminal view. */
export type TerminalSessionTransport = Pick<
  TerminalTransportController,
  "subscribe" | "acknowledge" | "write" | "resize" | "releaseEmulator"
>;

/** Input that did not reach the host, or whose delivery the host could not confirm. */
export type TerminalInputNotice =
  | { kind: "unknown"; guidance: string }
  | { kind: "not_sent"; message: string };

export type TerminalSessionState = {
  /** The page parsed the output through the attachment snapshot. */
  hydrated: boolean;
  /** The lifecycle from the terminal stream, or null before its snapshot. */
  lifecycle: TerminalLifecycle | null;
  exit: TerminalExitNotice | null;
  /** An output, sync, or protocol failure of this terminal. */
  attention: string | null;
  /** The host no longer has the terminal. */
  forgotten: string | null;
  inputNotice: TerminalInputNotice | null;
  /** True when the user can type: commands are open and the terminal runs. */
  inputEnabled: boolean;
  /** The page has selected text. The page sends the text only for a copy. */
  hasSelection: boolean;
};

export type TerminalSessionOptions = {
  terminalId: string;
  transport: TerminalSessionTransport;
  frames: TerminalFrameScheduler;
  /** Host commands are open. Terminal input follows the command gate. */
  commandsOpen: boolean;
  onLifecycle: (lifecycle: TerminalLifecycle) => void;
  onTitle: (title: string) => void;
  onForgotten: (message: string) => void;
  /** The selected text, from the Copy key or a hardware copy shortcut. The caller writes it. */
  onCopy: (text: string) => void;
  onLink: (url: string) => void;
  /** The page used the held touch modifiers for typed text. */
  onModifiersConsumed: () => void;
};

export const INPUT_DELIVERY_UNKNOWN = "Input delivery unknown";

const STATE_KEYS = [
  "hydrated",
  "lifecycle",
  "exit",
  "attention",
  "forgotten",
  "inputNotice",
  "inputEnabled",
  "hasSelection",
] as const satisfies readonly (keyof TerminalSessionState)[];

const inputFailureNotice = (cause: unknown): TerminalInputNotice =>
  isOutcomeUnknown(cause)
    ? { kind: "unknown", guidance: cause.failure.nextAction }
    : { kind: "not_sent", message: errorMessage(cause) };

/**
 * Connects one terminal page to the shared transport controller. The page draws; this session
 * attaches, sends output to the page at most once per display frame, acknowledges output only
 * after the page reports that xterm.js parsed it, and writes input in order. Input with a lost
 * delivery result shows a notice and is never sent again.
 */
export const createTerminalSession = (options: TerminalSessionOptions) => {
  const { terminalId, transport } = options;
  const listeners = new Set<() => void>();
  let commandsOpen = options.commandsOpen;
  let state: TerminalSessionState = {
    hydrated: false,
    lifecycle: null,
    exit: null,
    attention: null,
    forgotten: null,
    inputNotice: null,
    inputEnabled: commandsOpen,
    hasSelection: false,
  };
  let unsubscribe: (() => void) | null = null;
  let disposed = false;

  const update = (patch: Partial<TerminalSessionState>): void => {
    const next = { ...state, ...patch };
    next.inputEnabled = commandsOpen && next.lifecycle !== "exited" && next.forgotten === null;
    if (STATE_KEYS.every((key) => next[key] === state[key])) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const reportAttention = (title: string) => (cause: unknown) => {
    if (!disposed) update({ attention: `${title}: ${errorMessage(cause)}` });
  };

  let post: ((message: TerminalPageInbound) => void) | null = null;
  const batcher = createTerminalPageBatcher({
    ...options.frames,
    post: (message) => post?.(message),
  });
  const resizeScheduler = createLatestResizeScheduler((columns, rows) => {
    void transport
      .resize(terminalId, columns, rows)
      .catch(reportAttention("Terminal resize failed"));
  });
  const enqueueInput = createTerminalInputSequencer({
    isActive: () => !disposed && unsubscribe !== null && state.inputEnabled,
    writeInput: async (data) => {
      resizeScheduler.flush();
      await transport.write(terminalId, data);
      if (state.inputNotice?.kind === "not_sent") update({ inputNotice: null });
    },
    reportFailure: (cause) => {
      if (disposed || state.inputNotice?.kind === "unknown") return;
      update({ inputNotice: inputFailureNotice(cause) });
    },
  });

  const handleFrame = (message: TerminalServerMessage, payload: Uint8Array): void => {
    if (message.type === "snapshot") {
      batcher.push({ kind: "snapshot", sequenceEnd: message.snapshotSequenceEnd });
    }
    if (message.type === "screen_restore") {
      batcher.push({
        kind: "restore",
        sequenceEnd: message.sequenceEnd,
        columns: message.columns,
        rows: message.rows,
        precedingJoinState: message.precedingJoinState,
        payload,
      });
      return;
    }
    const handled = handleTerminalMetadataFrame(message, {
      onAttention: (attention) => update({ attention }),
      onLifecycle: (lifecycle, exit) => {
        update(exit === null ? { lifecycle } : { lifecycle, exit });
        options.onLifecycle(lifecycle);
      },
      onTitle: options.onTitle,
      onForgotten: (forgotten) => {
        update({ forgotten });
        options.onForgotten(forgotten);
      },
      onFailure: (attention) => update({ attention }),
    });
    if (handled || message.type !== "output") return;
    batcher.push({
      kind: "output",
      sequenceStart: message.sequenceStart,
      sequenceEnd: message.sequenceEnd,
      payload,
    });
  };

  /** The page closed or stopped. The next page attaches again and gets the full screen. */
  const detachPage = (): void => {
    batcher.clear();
    post = null;
    // A reloaded page shows the attach progress until it parsed the screen again.
    update({ hydrated: false, hasSelection: false });
    if (unsubscribe === null) return;
    // Forget the parsed position first, so the next attach asks the host for the whole screen.
    transport.releaseEmulator(terminalId);
    unsubscribe();
    unsubscribe = null;
  };

  return {
    read: (): TerminalSessionState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * The page opened xterm.js at `columns` by `rows`. Attaches to the host terminal, which sends
     * its snapshot and retained output.
     */
    attachPage(postToPage: (message: TerminalPageInbound) => void, columns: number, rows: number) {
      if (disposed || unsubscribe !== null) return;
      post = postToPage;
      update({ hydrated: false, attention: null, hasSelection: false });
      unsubscribe = transport.subscribe(terminalId, handleFrame);
      resizeScheduler.schedule(columns, rows);
    },
    detachPage,
    receive(message: TerminalPageOutbound): void {
      if (disposed) return;
      switch (message.type) {
        case "terminal_ready":
          return;
        case "terminal_hydrated":
          update({ hydrated: true });
          return;
        case "terminal_consumed":
          void transport
            .acknowledge(terminalId, message.sequenceEnd)
            .catch(reportAttention("Terminal output sync failed"));
          return;
        case "terminal_input": {
          // Input typed while input is off never reaches the host, also not later.
          const input = state.inputEnabled ? encodeTerminalTextInput(message.data) : null;
          if (input) void enqueueInput(() => input);
          return;
        }
        case "terminal_resize":
          resizeScheduler.schedule(message.columns, message.rows);
          return;
        case "terminal_selection":
          update({ hasSelection: message.hasSelection });
          return;
        case "terminal_copy":
          options.onCopy(message.text);
          return;
        case "terminal_modifiers_consumed":
          options.onModifiersConsumed();
          return;
        case "terminal_error":
          update({ attention: message.message });
          return;
        case "link":
          options.onLink(message.url);
          return;
      }
    },
    setCommandsOpen(open: boolean): void {
      commandsOpen = open;
      update({});
    },
    dismissInputNotice(): void {
      update({ inputNotice: null });
    },
    dispose(): void {
      if (disposed) return;
      detachPage();
      disposed = true;
      listeners.clear();
    },
  };
};

export type TerminalSession = ReturnType<typeof createTerminalSession>;
