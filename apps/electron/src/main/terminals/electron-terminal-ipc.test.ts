import { describe, expect, test } from "bun:test";
import { encodeTerminalProtocolFrame, TERMINAL_PROTOCOL_VERSION } from "@openducktor/contracts";
import type { TerminalService } from "@openducktor/host";
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
});
