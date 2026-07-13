import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import { type TerminalService, TerminalServiceError } from "@openducktor/host";
import { Effect } from "effect";
import { createElectronTerminalIpcController } from "./electron-terminal-ipc";

describe("Electron terminal IPC", () => {
  test("validates frames and scopes attachments to the sender", async () => {
    const calls: string[] = [];
    const terminalService = {
      attach: (input: { attachmentId: string; terminalId: string }) =>
        Effect.sync(() => calls.push(`attach:${input.attachmentId}`)),
      detach: (_terminalId: string, attachmentId: string) =>
        Effect.sync(() => calls.push(`detach:${attachmentId}`)),
    } as TerminalService;
    const controller = createElectronTerminalIpcController(terminalService);
    const sender = { id: 7, isDestroyed: () => false, send: () => undefined };
    const frame = encodeTerminalProtocolFrame({
      message: {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "attach",
        terminalId: "terminal-1",
        lastConsumedSequence: null,
      },
      payload: new Uint8Array(),
    });
    await Effect.runPromise(controller.handleFrame(sender, frame));
    await Effect.runPromise(controller.detachSender(sender.id));
    expect(calls).toEqual(["attach:electron:7:terminal-1", "detach:electron:7:terminal-1"]);
    await expect(Effect.runPromise(controller.handleFrame(sender, "bad"))).rejects.toThrow(
      "Uint8Array",
    );
  });

  test("reports repeated stale attaches without retaining sender attachments", async () => {
    const detached: string[] = [];
    const terminalService = {
      attach: ({ terminalId }: Parameters<TerminalService["attach"]>[0]) =>
        Effect.fail(
          new TerminalServiceError({
            code: "terminal_not_found",
            operation: "attach",
            message: `Terminal not found: ${terminalId}`,
            terminalId,
          }),
        ),
      detach: (terminalId: string) => Effect.sync(() => detached.push(terminalId)),
    } as TerminalService;
    const controller = createElectronTerminalIpcController(terminalService);
    const sent: Uint8Array[] = [];
    const sender = {
      id: 7,
      isDestroyed: () => false,
      send: (_channel: string, frame: Uint8Array) => sent.push(frame),
    };

    for (let index = 0; index < 100; index += 1) {
      await Effect.runPromise(
        controller.handleFrame(
          sender,
          encodeTerminalProtocolFrame({
            message: {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "attach",
              terminalId: `missing-${index}`,
              lastConsumedSequence: null,
            },
            payload: new Uint8Array(),
          }),
        ),
      );
    }
    await Effect.runPromise(controller.detachSender(sender.id));

    expect(detached).toEqual([]);
    expect(sent).toHaveLength(100);
    expect(
      sent.every((frame) => {
        const message = decodeTerminalProtocolFrame(frame).message;
        return message.type === "protocol_error" && message.failure.code === "terminal_forgotten";
      }),
    ).toBe(true);
  });
});
