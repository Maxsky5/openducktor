import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import { type TerminalService, TerminalServiceError } from "@openducktor/host";
import { Effect } from "effect";
import {
  createElectronTerminalIpcController,
  shouldDetachTerminalSenderForNavigation,
} from "./electron-terminal-ipc";

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
    await Effect.runPromise(controller.handleFrame(sender, "client-a", frame));
    await Effect.runPromise(controller.detachSender(sender.id));
    expect(calls).toEqual([
      "attach:electron:7:client-a:terminal-1",
      "detach:electron:7:client-a:terminal-1",
    ]);
    await expect(
      Effect.runPromise(controller.handleFrame(sender, "client-a", "bad")),
    ).rejects.toThrow("Uint8Array");
  });

  test("disconnects one logical renderer client without waiting for WebContents teardown", async () => {
    const calls: string[] = [];
    const terminalService = {
      attach: (input: Parameters<TerminalService["attach"]>[0]) =>
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

    await Effect.runPromise(controller.handleFrame(sender, "client-a", frame));
    await Effect.runPromise(controller.detachClient(sender.id, "client-a"));

    expect(calls).toEqual([
      "attach:electron:7:client-a:terminal-1",
      "detach:electron:7:client-a:terminal-1",
    ]);
  });

  test("keeps live attachments during same-document main-frame navigation", async () => {
    const attachments = new Set<string>();
    const terminalService = {
      attach: (input: Parameters<TerminalService["attach"]>[0]) =>
        Effect.sync(() => attachments.add(input.attachmentId)),
      detach: (_terminalId: string, attachmentId: string) =>
        Effect.sync(() => attachments.delete(attachmentId)),
      acknowledge: (terminalId: string, attachmentId: string) =>
        attachments.has(attachmentId)
          ? Effect.void
          : Effect.fail(
              new TerminalServiceError({
                code: "terminal_not_found",
                operation: "ack",
                message: `Terminal attachment not found: ${attachmentId}`,
                terminalId,
              }),
            ),
    } as TerminalService;
    const controller = createElectronTerminalIpcController(terminalService);
    const sender = { id: 7, isDestroyed: () => false, send: () => undefined };
    await Effect.runPromise(
      controller.handleFrame(
        sender,
        "client-a",
        encodeTerminalProtocolFrame({
          message: {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "attach",
            terminalId: "terminal-1",
            lastConsumedSequence: null,
          },
          payload: new Uint8Array(),
        }),
      ),
    );

    if (shouldDetachTerminalSenderForNavigation({ isMainFrame: true, isSameDocument: true })) {
      await Effect.runPromise(controller.detachSender(sender.id));
    }

    await expect(
      Effect.runPromise(
        controller.handleFrame(
          sender,
          "client-a",
          encodeTerminalProtocolFrame({
            message: {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "ack",
              terminalId: "terminal-1",
              sequenceEnd: 1,
            },
            payload: new Uint8Array(),
          }),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  test("detaches terminal senders only for cross-document main-frame navigation", () => {
    expect(
      shouldDetachTerminalSenderForNavigation({ isMainFrame: true, isSameDocument: false }),
    ).toBe(true);
    expect(
      shouldDetachTerminalSenderForNavigation({ isMainFrame: false, isSameDocument: false }),
    ).toBe(false);
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
      send: (_channel: string, envelope: { frame: Uint8Array }) => sent.push(envelope.frame),
    };

    for (let index = 0; index < 100; index += 1) {
      await Effect.runPromise(
        controller.handleFrame(
          sender,
          "client-a",
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

  test("serializes a replacement attach behind an in-flight detach", async () => {
    let releaseDetach = (): void => {
      throw new Error("The detach operation was not started.");
    };
    const detachBlocked = new Promise<void>((resolve) => {
      releaseDetach = resolve;
    });
    let markDetachStarted = (): void => undefined;
    const detachStarted = new Promise<void>((resolve) => {
      markDetachStarted = resolve;
    });
    const attachments = new Set<string>();
    const operations: string[] = [];
    const terminalService = {
      attach: (input: Parameters<TerminalService["attach"]>[0]) =>
        Effect.sync(() => {
          operations.push("attach");
          attachments.add(input.attachmentId);
        }),
      detach: (_terminalId: string, attachmentId: string) =>
        Effect.gen(function* () {
          operations.push("detach:start");
          markDetachStarted();
          yield* Effect.promise(() => detachBlocked);
          attachments.delete(attachmentId);
          operations.push("detach:complete");
        }),
      acknowledge: (terminalId: string, attachmentId: string) =>
        attachments.has(attachmentId)
          ? Effect.void
          : Effect.fail(
              new TerminalServiceError({
                code: "terminal_not_found",
                operation: "ack",
                message: `Terminal attachment not found: ${attachmentId}`,
                terminalId,
              }),
            ),
    } as TerminalService;
    const controller = createElectronTerminalIpcController(terminalService);
    const sender = { id: 7, isDestroyed: () => false, send: () => undefined };
    const frame = (
      message:
        | { type: "attach"; lastConsumedSequence: null }
        | { type: "detach" }
        | { type: "ack"; sequenceEnd: number },
    ): Uint8Array =>
      encodeTerminalProtocolFrame({
        message: {
          version: TERMINAL_PROTOCOL_VERSION,
          terminalId: "terminal-1",
          ...message,
        },
        payload: new Uint8Array(),
      });

    await Effect.runPromise(
      controller.handleFrame(
        sender,
        "client-a",
        frame({ type: "attach", lastConsumedSequence: null }),
      ),
    );
    const detaching = Effect.runPromise(
      controller.handleFrame(sender, "client-a", frame({ type: "detach" })),
    );
    await detachStarted;
    const replacing = Effect.runPromise(
      controller.handleFrame(
        sender,
        "client-a",
        frame({ type: "attach", lastConsumedSequence: null }),
      ),
    );

    releaseDetach();
    await Promise.all([detaching, replacing]);

    await expect(
      Effect.runPromise(
        controller.handleFrame(sender, "client-a", frame({ type: "ack", sequenceEnd: 1 })),
      ),
    ).resolves.toBeUndefined();
    expect(operations).toEqual(["attach", "detach:start", "detach:complete", "attach"]);
  });
});
