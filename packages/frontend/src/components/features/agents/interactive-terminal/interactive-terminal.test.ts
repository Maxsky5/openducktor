import { describe, expect, test } from "bun:test";
import { TERMINAL_PROTOCOL_VERSION } from "@openducktor/contracts";
import {
  createLatestResizeScheduler,
  createTerminalInputSequencer,
  createTerminalKeyEventHandler,
  createTerminalOutputSequencer,
  handleTerminalMetadataFrame,
  normalizeTerminalTitle,
  resolveTerminalKeyAction,
} from "./interactive-terminal-policy";

const keyEvent = (overrides: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    type: "keydown",
    ...overrides,
  }) as KeyboardEvent;

describe("InteractiveTerminal policies", () => {
  test("normalizes live shell titles without exposing control characters", () => {
    expect(normalizeTerminalTitle("  pnpm run dev\u0007  ", "/repo/worktree")).toBe("pnpm run dev");
    expect(normalizeTerminalTitle("\u0000\u001f", "/repo/worktree")).toBe("/repo/worktree");
    expect(normalizeTerminalTitle("maxsky5@studio:~/repo/worktree", "/repo/worktree")).toBe(
      "~/repo/worktree",
    );
    expect(normalizeTerminalTitle("x".repeat(300), "/repo/worktree")).toHaveLength(160);
  });

  test("keeps copy, paste, and Ctrl+C interrupt semantics distinct", () => {
    expect(resolveTerminalKeyAction(keyEvent({ ctrlKey: true, key: "c" }), false, true)).toBe(
      "copy",
    );
    expect(resolveTerminalKeyAction(keyEvent({ ctrlKey: true, key: "c" }), false, false)).toBe(
      "interrupt",
    );
    expect(
      resolveTerminalKeyAction(keyEvent({ ctrlKey: true, key: "v", shiftKey: true }), false, false),
    ).toBe("paste");
    expect(resolveTerminalKeyAction(keyEvent({ key: "c", metaKey: true }), true, true)).toBe(
      "copy",
    );
  });

  test("wires copy, paste, and interrupt to clipboard and terminal input", async () => {
    const clipboardWrites: string[] = [];
    const inputWrites: number[][] = [];
    const failures: unknown[] = [];
    let selected = true;
    let inputIdle = Promise.resolve();
    const sequenceInput = createTerminalInputSequencer({
      writeInput: async (data) => {
        inputWrites.push([...data]);
      },
      reportFailure: (cause) => failures.push(cause),
    });
    const enqueueInput = (operation: () => Uint8Array | Promise<Uint8Array>) => {
      inputIdle = sequenceInput(operation);
      return inputIdle;
    };
    const handleKey = createTerminalKeyEventHandler({
      isMac: false,
      hasSelection: () => selected,
      getSelection: () => "selected output",
      writeClipboard: async (text) => {
        clipboardWrites.push(text);
      },
      readClipboard: async () => "pasted input",
      enqueueInput,
      reportFailure: (cause) => failures.push(cause),
    });

    expect(handleKey(keyEvent({ ctrlKey: true, key: "c", shiftKey: true }))).toBe(false);
    expect(handleKey(keyEvent({ ctrlKey: true, key: "v", shiftKey: true }))).toBe(false);
    selected = false;
    expect(handleKey(keyEvent({ ctrlKey: true, key: "c" }))).toBe(false);
    await inputIdle;

    expect(clipboardWrites).toEqual(["selected output"]);
    expect(inputWrites).toEqual([[...new TextEncoder().encode("pasted input")], [3]]);
    expect(failures).toEqual([]);
  });

  test("surfaces clipboard failures without injecting terminal input", async () => {
    const inputWrites: number[][] = [];
    const failures: string[] = [];
    let inputIdle = Promise.resolve();
    const sequenceInput = createTerminalInputSequencer({
      writeInput: async (data) => {
        inputWrites.push([...data]);
      },
      reportFailure: (cause) =>
        failures.push(cause instanceof Error ? cause.message : String(cause)),
    });
    const enqueueInput = (operation: () => Uint8Array | Promise<Uint8Array>) => {
      inputIdle = sequenceInput(operation);
      return inputIdle;
    };
    const handleKey = createTerminalKeyEventHandler({
      isMac: true,
      hasSelection: () => false,
      getSelection: () => "",
      writeClipboard: async () => undefined,
      readClipboard: async () => {
        throw new Error("clipboard denied");
      },
      enqueueInput,
      reportFailure: (cause) =>
        failures.push(cause instanceof Error ? cause.message : String(cause)),
    });

    expect(handleKey(keyEvent({ key: "v", metaKey: true }))).toBe(false);
    await inputIdle;

    expect(inputWrites).toEqual([]);
    expect(failures).toEqual(["clipboard denied"]);
  });

  test("coalesces resize bursts to the latest grid and flushes before input", () => {
    const callbacks: Array<() => void> = [];
    const grids: string[] = [];
    const scheduler = createLatestResizeScheduler(
      (columns, rows) => grids.push(`${columns}x${rows}`),
      (callback) => callbacks.push(callback),
    );
    scheduler.schedule(80, 24);
    scheduler.schedule(100, 30);
    scheduler.schedule(120, 40);
    expect(callbacks).toHaveLength(1);
    scheduler.flush();
    expect(grids).toEqual(["120x40"]);
  });

  test("preserves paste ordering before later typed input", async () => {
    const writes: string[] = [];
    const clipboardState: { resolve: ((text: string) => void) | null } = { resolve: null };
    const clipboard = new Promise<string>((resolve) => {
      clipboardState.resolve = resolve;
    });
    const enqueueInput = createTerminalInputSequencer({
      writeInput: async (data) => {
        writes.push(new TextDecoder().decode(data));
      },
      reportFailure: () => undefined,
    });

    const paste = enqueueInput(async () => new TextEncoder().encode(await clipboard));
    const typed = enqueueInput(() => new TextEncoder().encode("typed"));
    const resolveClipboard = clipboardState.resolve;
    if (!resolveClipboard) throw new Error("Expected clipboard resolver.");
    resolveClipboard("pasted");
    await Promise.all([paste, typed]);

    expect(writes).toEqual(["pasted", "typed"]);
  });

  test("marks incomplete replay before retained output is rendered", () => {
    const events: string[] = [];
    const handlers = {
      reset: () => events.push("reset"),
      onAttention: (message: string | null) => events.push(`attention:${message}`),
      onLifecycle: (lifecycle: string) => events.push(`lifecycle:${lifecycle}`),
      onForgotten: () => undefined,
      onFailure: () => undefined,
    };
    expect(
      handleTerminalMetadataFrame(
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "snapshot",
          terminalId: "terminal-1",
          earliestRetainedSequence: 10,
          snapshotSequenceEnd: 20,
          lifecycle: "running",
          complete: false,
        },
        handlers,
      ),
    ).toBe(true);
    expect(
      handleTerminalMetadataFrame(
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "replay_gap",
          terminalId: "terminal-1",
          missingSequenceStart: 0,
          missingSequenceEnd: 10,
        },
        handlers,
      ),
    ).toBe(true);
    const outputHandled = handleTerminalMetadataFrame(
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "output",
        terminalId: "terminal-1",
        sequenceStart: 10,
        sequenceEnd: 20,
        replay: true,
      },
      handlers,
    );
    if (!outputHandled) events.push("output");

    expect(events).toEqual([
      "lifecycle:running",
      "reset",
      "attention:Incomplete replay: output 0–10 is unavailable.",
      "output",
    ]);
  });

  test("routes forgotten and protocol failure frames to visible failure handlers", () => {
    const events: string[] = [];
    const handlers = {
      reset: () => undefined,
      onAttention: (message: string | null) => events.push(`attention:${message}`),
      onLifecycle: () => undefined,
      onForgotten: (message: string) => events.push(`forgotten:${message}`),
      onFailure: (message: string) => events.push(`failure:${message}`),
    };

    handleTerminalMetadataFrame(
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "terminal_forgotten",
        terminalId: "terminal-1",
      },
      handlers,
    );
    handleTerminalMetadataFrame(
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "protocol_error",
        terminalId: "terminal-1",
        failure: {
          code: "terminal_forgotten",
          message: "Terminal was lost during host restart.",
          terminalId: "terminal-1",
        },
      },
      handlers,
    );
    handleTerminalMetadataFrame(
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "protocol_error",
        terminalId: "terminal-1",
        failure: {
          code: "invalid_input",
          message: "Terminal input was rejected.",
          terminalId: "terminal-1",
        },
      },
      handlers,
    );
    handleTerminalMetadataFrame(
      {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "protocol_error",
        terminalId: "terminal-1",
        failure: {
          code: "terminal_not_found",
          message: "Terminal attachment was not found.",
          terminalId: "terminal-1",
        },
      },
      handlers,
    );

    expect(events).toEqual([
      "forgotten:This terminal is no longer available from the host.",
      "forgotten:Terminal was lost during host restart.",
      "failure:Terminal input was rejected.",
      "failure:Terminal attachment was not found.",
    ]);
  });

  test("acknowledges output only after the terminal parser callback", async () => {
    const parsed: { value: (() => void) | null } = { value: null };
    const acknowledgements: number[] = [];
    const sequencer = createTerminalOutputSequencer({
      write: (_payload, callback) => {
        parsed.value = callback;
      },
      onConsumed: (sequenceEnd) => acknowledgements.push(sequenceEnd),
    });
    const completed = sequencer.enqueue(
      { sequenceStart: 0, sequenceEnd: 2 },
      new Uint8Array([1, 2]),
    );
    await Promise.resolve();
    expect(acknowledgements).toEqual([]);
    const parsedCallback = parsed.value;
    if (!parsedCallback) throw new Error("Expected terminal parser callback.");
    parsedCallback();
    await completed;
    expect(acknowledgements).toEqual([2]);
  });

  test("reveals a restored terminal only after its snapshot has been fully parsed", async () => {
    const parserCallbacks: Array<() => void> = [];
    const hydrationEvents: string[] = [];
    const sequencer = createTerminalOutputSequencer({
      write: (_payload, parsed) => parserCallbacks.push(parsed),
      onConsumed: () => undefined,
      onHydrated: () => hydrationEvents.push("hydrated"),
    });

    sequencer.setSnapshotBoundary(4);
    expect(hydrationEvents).toEqual([]);

    const replay = sequencer.enqueue(
      { sequenceStart: 0, sequenceEnd: 4 },
      new Uint8Array([1, 2, 3, 4]),
    );
    await Promise.resolve();
    expect(hydrationEvents).toEqual([]);

    parserCallbacks[0]?.();
    await replay;
    expect(hydrationEvents).toEqual(["hydrated"]);
  });

  test("reveals an empty restored terminal as soon as its snapshot arrives", () => {
    const hydrationEvents: string[] = [];
    const sequencer = createTerminalOutputSequencer({
      write: () => undefined,
      onConsumed: () => undefined,
      onHydrated: () => hydrationEvents.push("hydrated"),
    });

    sequencer.setSnapshotBoundary(0);

    expect(hydrationEvents).toEqual(["hydrated"]);
  });

  test("renders a replayed range only once when reconnect happens before ACK", async () => {
    const parserCallbacks: Array<() => void> = [];
    const writes: number[][] = [];
    const acknowledgements: number[] = [];
    const sequencer = createTerminalOutputSequencer({
      write: (payload, parsed) => {
        writes.push([...payload]);
        parserCallbacks.push(parsed);
      },
      onConsumed: (sequenceEnd) => acknowledgements.push(sequenceEnd),
    });

    const original = sequencer.enqueue(
      { sequenceStart: 0, sequenceEnd: 2 },
      new Uint8Array([1, 2]),
    );
    await Promise.resolve();
    const replay = sequencer.enqueue({ sequenceStart: 0, sequenceEnd: 2 }, new Uint8Array([1, 2]));
    parserCallbacks[0]?.();
    await Promise.all([original, replay]);

    expect(writes).toEqual([[1, 2]]);
    expect(acknowledgements).toEqual([2]);
  });

  test("resets after an in-flight pre-gap write without regressing the ACK", async () => {
    const parserCallbacks: Array<() => void> = [];
    const events: string[] = [];
    const acknowledgements: number[] = [];
    const sequencer = createTerminalOutputSequencer({
      write: (payload, parsed) => {
        events.push(`write:${[...payload].join(",")}`);
        parserCallbacks.push(() => {
          events.push(`parsed:${[...payload].join(",")}`);
          parsed();
        });
      },
      onConsumed: (sequenceEnd) => acknowledgements.push(sequenceEnd),
    });

    const staleWrite = sequencer.enqueue(
      { sequenceStart: 0, sequenceEnd: 5 },
      new Uint8Array([1, 2, 3, 4, 5]),
    );
    await Promise.resolve();
    const reset = sequencer.skipTo(10, () => events.push("reset"));
    const currentWrite = sequencer.enqueue(
      { sequenceStart: 10, sequenceEnd: 12 },
      new Uint8Array([11, 12]),
    );

    parserCallbacks[0]?.();
    await Promise.all([staleWrite, reset]);
    expect(events).toEqual(["write:1,2,3,4,5", "parsed:1,2,3,4,5", "reset", "write:11,12"]);
    expect(acknowledgements).toEqual([]);

    parserCallbacks[1]?.();
    await currentWrite;
    expect(acknowledgements).toEqual([12]);
  });
});
