import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_MAX_COLUMNS,
  TERMINAL_PROTOCOL_MAX_INPUT_BYTES,
  TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES,
  TERMINAL_PROTOCOL_MAX_ROWS,
  TERMINAL_PROTOCOL_VERSION,
  terminalClientMessageSchema,
  terminalServerMessageSchema,
} from "./terminal-protocol";

const inputMessage = { version: 1 as const, type: "input" as const, terminalId: "terminal-1" };

describe("terminal protocol", () => {
  test("round trips binary input at the exact input limit", () => {
    const payload = new Uint8Array(TERMINAL_PROTOCOL_MAX_INPUT_BYTES);
    const decoded = decodeTerminalProtocolFrame(
      encodeTerminalProtocolFrame({ message: inputMessage, payload }),
    );
    expect(decoded.message).toEqual(inputMessage);
    expect(decoded.payload.byteLength).toBe(TERMINAL_PROTOCOL_MAX_INPUT_BYTES);
  });

  test("rejects input one byte above the limit", () => {
    expect(() =>
      encodeTerminalProtocolFrame({
        message: inputMessage,
        payload: new Uint8Array(TERMINAL_PROTOCOL_MAX_INPUT_BYTES + 1),
      }),
    ).toThrow("64 KiB");
  });

  test("accepts exact grid maxima and rejects maximum plus one", () => {
    const base = { version: 1, type: "resize", terminalId: "terminal-1" };
    expect(
      terminalClientMessageSchema.parse({
        ...base,
        columns: TERMINAL_PROTOCOL_MAX_COLUMNS,
        rows: TERMINAL_PROTOCOL_MAX_ROWS,
      }),
    ).toBeDefined();
    expect(() =>
      terminalClientMessageSchema.parse({
        ...base,
        columns: TERMINAL_PROTOCOL_MAX_COLUMNS + 1,
        rows: TERMINAL_PROTOCOL_MAX_ROWS,
      }),
    ).toThrow();
  });

  test("compiled output retains the sequence validation message and field path", () => {
    const result = terminalServerMessageSchema.safeParse({
      version: 1,
      type: "output",
      terminalId: "terminal-1",
      sequenceStart: 2,
      sequenceEnd: 2,
      replay: false,
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected output sequence validation to fail.");
    expect(result.error.issues).toEqual([
      {
        code: "custom",
        message: "sequenceEnd must be greater than sequenceStart",
        path: ["sequenceEnd"],
      },
    ]);
  });

  test("rejects malformed discriminants and wrong versions", () => {
    expect(() =>
      terminalClientMessageSchema.parse({ version: 1, type: "unknown", terminalId: "x" }),
    ).toThrow();
    expect(() =>
      terminalClientMessageSchema.parse({
        version: 2,
        type: "attach",
        terminalId: "x",
        lastConsumedSequence: null,
      }),
    ).toThrow();
  });

  test("round trips host-owned snapshot and live terminal titles", () => {
    const snapshot = {
      version: TERMINAL_PROTOCOL_VERSION,
      type: "snapshot" as const,
      terminalId: "terminal-1",
      earliestRetainedSequence: 0,
      snapshotSequenceEnd: 0,
      lifecycle: "running" as const,
      title: "~/projects/openducktor",
      complete: true,
    };
    const title = {
      version: TERMINAL_PROTOCOL_VERSION,
      type: "title" as const,
      terminalId: "terminal-1",
      title: "pnpm run dev",
    };

    expect(
      decodeTerminalProtocolFrame(
        encodeTerminalProtocolFrame({ message: snapshot, payload: new Uint8Array() }),
      ).message,
    ).toEqual(snapshot);
    expect(
      decodeTerminalProtocolFrame(
        encodeTerminalProtocolFrame({ message: title, payload: new Uint8Array() }),
      ).message,
    ).toEqual(title);
  });

  test("round trips a screen restore with its terminal grid", () => {
    const message = {
      version: TERMINAL_PROTOCOL_VERSION,
      type: "screen_restore" as const,
      terminalId: "terminal-1",
      sequenceEnd: 2_097_152,
      columns: 120,
      rows: 40,
    };
    const payload = new TextEncoder().encode("\u001b[?1049h\u001b[Hcurrent screen");
    const decoded = decodeTerminalProtocolFrame(encodeTerminalProtocolFrame({ message, payload }));
    expect(decoded).toEqual({ message, payload });
    expect(() => encodeTerminalProtocolFrame({ message, payload: new Uint8Array() })).toThrow(
      "requires a non-empty binary payload",
    );
  });

  test("carries a full large TUI screen in one restore frame", () => {
    const message = {
      version: TERMINAL_PROTOCOL_VERSION,
      type: "screen_restore" as const,
      terminalId: "terminal-1",
      sequenceEnd: 1,
      columns: 500,
      rows: 300,
    };
    const payload = new Uint8Array(2 * 1024 * 1024);
    payload.fill(65);
    const decoded = decodeTerminalProtocolFrame(encodeTerminalProtocolFrame({ message, payload }));
    expect(decoded.message).toEqual(message);
    expect(decoded.payload).toEqual(payload);
  });

  test("rejects truncated, oversized, and mismatched frames before payload use", () => {
    expect(() => decodeTerminalProtocolFrame(new Uint8Array(3))).toThrow("header length");
    expect(() =>
      decodeTerminalProtocolFrame(new Uint8Array(TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES + 1)),
    ).toThrow("8 MiB");
    const encoded = encodeTerminalProtocolFrame({
      message: inputMessage,
      payload: new Uint8Array([1]),
    });
    expect(() => decodeTerminalProtocolFrame(encoded.subarray(0, encoded.length - 1))).toThrow(
      "payload length",
    );
  });
});
