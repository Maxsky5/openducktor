import { describe, expect, test } from "bun:test";
import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalLifecycle,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import type { TerminalFrameListener } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import type { TerminalFrameScheduler } from "@openducktor/frontend-core/terminals/terminal-viewport-policy";
import { remoteError } from "@openducktor/host-client/remote";
import { decodeBase64 } from "@/rich-content/isolated-page/terminal-bytes";
import type { TerminalPageInbound } from "@/rich-content/isolated-page/terminal-page-messages";
import {
  createTerminalSession,
  type TerminalSessionOptions,
  type TerminalSessionTransport,
} from "./terminal-session";

const TERMINAL_ID = "terminal-1";
const version = TERMINAL_PROTOCOL_VERSION;
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const createManualFrames = (): TerminalFrameScheduler & { run(): void } => {
  const callbacks = new Map<number, (time: number) => void>();
  let nextId = 1;
  return {
    requestFrame: (callback) => {
      callbacks.set(nextId, callback);
      return nextId++;
    },
    cancelFrame: (id) => {
      callbacks.delete(id);
    },
    run: () => {
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const callback of due) callback(16);
    },
  };
};

const setup = (overrides: Partial<TerminalSessionOptions> = {}) => {
  const calls: string[] = [];
  const lifecycles: TerminalLifecycle[] = [];
  const forgotten: string[] = [];
  const posted: TerminalPageInbound[] = [];
  let listener: TerminalFrameListener | null = null;
  let write = async (_data: Uint8Array): Promise<void> => {};
  const transport: TerminalSessionTransport = {
    subscribe: (terminalId, frameListener) => {
      calls.push(`subscribe:${terminalId}`);
      listener = frameListener;
      return () => {
        calls.push(`unsubscribe:${terminalId}`);
        listener = null;
      };
    },
    acknowledge: async (_terminalId, sequenceEnd) => {
      calls.push(`ack:${sequenceEnd}`);
    },
    write: async (_terminalId, data) => {
      calls.push(`write:${decode(data)}`);
      await write(data);
    },
    resize: async (_terminalId, columns, rows) => {
      calls.push(`resize:${columns}x${rows}`);
    },
    releaseEmulator: (terminalId) => {
      calls.push(`release:${terminalId}`);
    },
  };
  const frames = createManualFrames();
  const session = createTerminalSession({
    terminalId: TERMINAL_ID,
    transport,
    frames,
    commandsOpen: true,
    onLifecycle: (lifecycle) => lifecycles.push(lifecycle),
    onTitle: () => undefined,
    onForgotten: (message) => forgotten.push(message),
    onCopy: () => undefined,
    onLink: () => undefined,
    onModifiersConsumed: () => undefined,
    ...overrides,
  });
  return {
    session,
    calls,
    posted,
    frames,
    lifecycles,
    forgotten,
    attach: () => session.attachPage((message) => posted.push(message), 80, 24),
    emit: (message: TerminalServerMessage, payload = new Uint8Array(0)) =>
      listener?.(message, payload),
    setWrite: (next: (data: Uint8Array) => Promise<void>) => {
      write = next;
    },
  };
};

const snapshot = (
  lifecycle: TerminalLifecycle,
  snapshotSequenceEnd = 3,
): TerminalServerMessage => ({
  version,
  type: "snapshot",
  terminalId: TERMINAL_ID,
  earliestRetainedSequence: 0,
  snapshotSequenceEnd,
  lifecycle,
  title: "zsh",
  complete: true,
});
const output = (sequenceStart: number, text: string): TerminalServerMessage => ({
  version,
  type: "output",
  terminalId: TERMINAL_ID,
  sequenceStart,
  sequenceEnd: sequenceStart + text.length,
  replay: false,
});

describe("createTerminalSession", () => {
  test("attaches only after the page opened and sends the page grid to the host", async () => {
    const view = setup();
    expect(view.calls).toEqual([]);
    view.attach();
    await flush();
    expect(view.calls).toEqual(["subscribe:terminal-1", "resize:80x24"]);
  });

  test("sends output once per display frame and acknowledges only what the page consumed", async () => {
    const view = setup();
    view.attach();
    view.emit(snapshot("running", 3));
    view.emit(output(0, "abc"), encode("abc"));
    view.emit(output(3, "de"), encode("de"));
    expect(view.posted).toEqual([]);

    view.frames.run();
    expect(view.posted.map((message) => message.type)).toEqual([
      "terminal_snapshot",
      "terminal_output",
    ]);
    const batch = view.posted[1];
    if (batch?.type !== "terminal_output") throw new Error("Expected output.");
    expect(batch.chunks.map((chunk) => decode(decodeBase64(chunk.bytes)))).toEqual(["abcde"]);
    await flush();
    expect(view.calls.filter((call) => call.startsWith("ack"))).toEqual([]);

    view.session.receive({ type: "terminal_consumed", sequenceEnd: 3 });
    view.session.receive({ type: "terminal_consumed", sequenceEnd: 5 });
    await flush();
    expect(view.calls.filter((call) => call.startsWith("ack"))).toEqual(["ack:3", "ack:5"]);
    expect(view.lifecycles).toEqual(["running"]);
  });

  test("sends screen restores to the page in order with later output", () => {
    const view = setup();
    view.attach();
    view.emit(
      {
        version,
        type: "screen_restore",
        terminalId: TERMINAL_ID,
        sequenceEnd: 40,
        columns: 120,
        rows: 30,
        precedingJoinState: 2,
      },
      encode("screen"),
    );
    view.emit(output(40, "x"), encode("x"));
    view.frames.run();
    expect(view.posted.map((message) => message.type)).toEqual([
      "terminal_restore",
      "terminal_output",
    ]);
    const restore = view.posted[0];
    if (restore?.type !== "terminal_restore") throw new Error("Expected a restore.");
    expect(decode(decodeBase64(restore.bytes))).toBe("screen");
  });

  test("shows the exit status and takes no input after the process exits", async () => {
    const view = setup();
    view.attach();
    view.emit({
      version,
      type: "lifecycle",
      terminalId: TERMINAL_ID,
      lifecycle: "exited",
      exitCode: 2,
    });
    expect(view.session.read()).toMatchObject({
      inputEnabled: false,
      lifecycle: "exited",
      exit: { text: "Exited with code 2.", isFailure: true },
    });
    view.session.receive({ type: "terminal_input", data: "ls\r" });
    await flush();
    expect(view.calls.some((call) => call.startsWith("write"))).toBe(false);
    expect(view.lifecycles).toEqual(["exited"]);
  });

  test("takes no input for a terminal that the host forgot", async () => {
    const view = setup();
    view.attach();
    view.emit({ version, type: "terminal_forgotten", terminalId: TERMINAL_ID });
    expect(view.session.read().inputEnabled).toBe(false);
    expect(view.forgotten).toEqual(["This terminal is no longer available from the host."]);
    view.session.receive({ type: "terminal_input", data: "x" });
    await flush();
    expect(view.calls.some((call) => call.startsWith("write"))).toBe(false);
  });

  test("follows the command gate", async () => {
    const view = setup({ commandsOpen: false });
    view.attach();
    expect(view.session.read().inputEnabled).toBe(false);
    view.session.receive({ type: "terminal_input", data: "a" });
    view.session.setCommandsOpen(true);
    expect(view.session.read().inputEnabled).toBe(true);
    view.session.receive({ type: "terminal_input", data: "b" });
    await flush();
    expect(view.calls.filter((call) => call.startsWith("write"))).toEqual(["write:b"]);
  });

  test("shows Input delivery unknown and never sends that input again", async () => {
    const view = setup();
    view.attach();
    view.setWrite(async () => {
      throw remoteError(
        "outcome_unknown",
        "Terminal input delivery is uncertain.",
        "Inspect the terminal. Do not replay input automatically.",
      );
    });
    view.session.receive({ type: "terminal_input", data: "rm -rf build\r" });
    await flush();
    expect(view.session.read().inputNotice).toEqual({
      kind: "unknown",
      guidance: "Inspect the terminal. Do not replay input automatically.",
    });
    expect(view.calls.filter((call) => call.startsWith("write"))).toEqual(["write:rm -rf build\r"]);

    // A later failure keeps the unknown result visible.
    view.setWrite(async () => {
      throw new Error("Terminal transport is disconnected.");
    });
    view.session.receive({ type: "terminal_input", data: "q" });
    await flush();
    expect(view.session.read().inputNotice?.kind).toBe("unknown");
    view.session.dismissInputNotice();
    expect(view.session.read().inputNotice).toBeNull();
  });

  test("reports input that did not leave and clears it after the next delivered input", async () => {
    const view = setup();
    view.attach();
    view.setWrite(async () => {
      throw new Error("Terminal transport is disconnected.");
    });
    view.session.receive({ type: "terminal_input", data: "a" });
    await flush();
    expect(view.session.read().inputNotice).toEqual({
      kind: "not_sent",
      message: "Terminal transport is disconnected.",
    });
    view.setWrite(async () => {});
    view.session.receive({ type: "terminal_input", data: "b" });
    await flush();
    expect(view.session.read().inputNotice).toBeNull();
  });

  test("sends a pending resize before input", async () => {
    const view = setup();
    view.attach();
    await flush();
    view.calls.length = 0;
    view.session.receive({ type: "terminal_resize", columns: 50, rows: 12 });
    view.session.receive({ type: "terminal_input", data: "x" });
    await flush();
    expect(view.calls).toEqual(["resize:50x12", "write:x"]);
  });

  test("keeps only whether the page has a selection, and the page sends its text to copy", () => {
    const copied: string[] = [];
    const view = setup({ onCopy: (text) => copied.push(text) });
    view.attach();
    view.session.receive({ type: "terminal_selection", hasSelection: true });
    expect(view.session.read().hasSelection).toBe(true);
    view.session.receive({ type: "terminal_copy", text: "make test" });
    expect(copied).toEqual(["make test"]);
    view.session.receive({ type: "terminal_selection", hasSelection: false });
    expect(view.session.read().hasSelection).toBe(false);
  });

  test("shows the attach progress again after the page stops", () => {
    const view = setup();
    view.attach();
    view.session.receive({ type: "terminal_hydrated" });
    view.session.receive({ type: "terminal_selection", hasSelection: true });
    view.session.detachPage();
    expect(view.session.read()).toMatchObject({ hydrated: false, hasSelection: false });
  });

  test("forgets the parsed position before it detaches, so a new page gets the whole screen", () => {
    const view = setup();
    view.attach();
    view.emit(output(0, "a"), encode("a"));
    view.session.detachPage();
    view.frames.run();
    expect(view.posted).toEqual([]);
    expect(view.calls.slice(-2)).toEqual(["release:terminal-1", "unsubscribe:terminal-1"]);
  });
});
