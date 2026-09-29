import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
} from "@openducktor/contracts";
import { type TerminalService, TerminalServiceError } from "@openducktor/host";
import { Effect } from "effect";
import { runElectronEffect } from "../../effect/electron-boundary";
import {
  createElectronTerminalIpcController,
  type ElectronTerminalIpcHandler,
  registerElectronTerminalIpc,
  shouldDetachTerminalSenderForNavigation,
} from "./electron-terminal-ipc";

const makeAttachFrame = (): Uint8Array =>
  encodeTerminalProtocolFrame({
    message: {
      version: TERMINAL_PROTOCOL_VERSION,
      type: "attach",
      terminalId: "terminal-1",
      lastConsumedSequence: null,
    },
    payload: new Uint8Array(),
  });

describe("Electron terminal IPC", () => {
  test("decodes frames and scopes attachments to the sender", async () => {
    const calls: string[] = [];
    const terminalService: TerminalService = {
      attach: (input: { attachmentId: string; terminalId: string }) =>
        Effect.sync(() => calls.push(`attach:${input.attachmentId}`)),
      detach: (_terminalId: string, attachmentId: string) =>
        Effect.sync(() => calls.push(`detach:${attachmentId}`)),
    };
    const controller = createElectronTerminalIpcController(terminalService);
    const sender = { id: 7, isDestroyed: () => false, send: () => undefined };
    const frame = makeAttachFrame();
    await Effect.runPromise(controller.handleFrame(sender, "client-a", frame));
    await Effect.runPromise(controller.detachSender(sender.id));
    expect(calls).toEqual([
      "attach:electron:7:client-a:terminal-1",
      "detach:electron:7:client-a:terminal-1",
    ]);
  });

  test("rejects malformed frames at the raw IPC boundary", async () => {
    let sendHandler: ElectronTerminalIpcHandler | undefined;
    registerElectronTerminalIpc({
      ipcMain: {
        handle(channel, handler) {
          if (channel === "openducktor:terminal:send") sendHandler = handler;
        },
      },
      reportLifecycleFailure: () => undefined,
      terminalService: {
        attach: () => Effect.void,
        detach: () => Effect.void,
      },
    });
    if (sendHandler === undefined) throw new Error("Expected terminal send handler registration.");

    await expect(
      sendHandler(
        {
          sender: {
            id: 7,
            isDestroyed: () => false,
            on: () => undefined,
            once: () => undefined,
            send: () => undefined,
          },
        },
        { clientId: "client-a", frame: "bad" },
      ),
    ).rejects.toMatchObject({
      _tag: "ElectronValidationError",
      field: "request",
      operation: "electron.terminal.request",
    });
  });

  test("disconnects one logical renderer client without waiting for WebContents teardown", async () => {
    const calls: string[] = [];
    const terminalService: TerminalService = {
      attach: (input: Parameters<TerminalService["attach"]>[0]) =>
        Effect.sync(() => calls.push(`attach:${input.attachmentId}`)),
      detach: (_terminalId: string, attachmentId: string) =>
        Effect.sync(() => calls.push(`detach:${attachmentId}`)),
    };
    const controller = createElectronTerminalIpcController(terminalService);
    const sender = { id: 7, isDestroyed: () => false, send: () => undefined };
    const frame = makeAttachFrame();

    await Effect.runPromise(controller.handleFrame(sender, "client-a", frame));
    await Effect.runPromise(controller.detachClient(sender.id, "client-a"));

    expect(calls).toEqual([
      "attach:electron:7:client-a:terminal-1",
      "detach:electron:7:client-a:terminal-1",
    ]);
  });

  test("tries every renderer client and retries failed cleanup on later teardown", async () => {
    const attempts: string[] = [];
    let failCleanup = true;
    const terminalService: TerminalService = {
      attach: () => Effect.void,
      detach: (terminalId, attachmentId) =>
        Effect.suspend(() => {
          attempts.push(attachmentId);
          if (!attachmentId.includes(":client-c:") && failCleanup) {
            return Effect.fail(
              new TerminalServiceError({
                code: "close_failed",
                operation: "detach",
                message: "Injected detach failure",
                terminalId,
              }),
            );
          }
          return Effect.void;
        }),
    };
    const controller = createElectronTerminalIpcController(terminalService);
    const sender = { id: 7, isDestroyed: () => false, send: () => undefined };
    const frame = makeAttachFrame();
    await Effect.runPromise(controller.handleFrame(sender, "client-a", frame));
    await Effect.runPromise(controller.handleFrame(sender, "client-b", frame));
    await Effect.runPromise(controller.handleFrame(sender, "client-c", frame));

    await expect(runElectronEffect(controller.detachSender(sender.id))).rejects.toMatchObject({
      errors: [{ message: "Injected detach failure" }, { message: "Injected detach failure" }],
      message: expect.stringContaining("client-a: Injected detach failure"),
    });
    expect(attempts).toEqual([
      "electron:7:client-a:terminal-1",
      "electron:7:client-b:terminal-1",
      "electron:7:client-c:terminal-1",
    ]);

    failCleanup = false;
    await Effect.runPromise(controller.detachSender(sender.id));
    expect(attempts).toEqual([
      "electron:7:client-a:terminal-1",
      "electron:7:client-b:terminal-1",
      "electron:7:client-c:terminal-1",
      "electron:7:client-a:terminal-1",
      "electron:7:client-b:terminal-1",
    ]);
  });

  test("reports lifecycle detach failures and retries on destruction", async () => {
    let navigate = (_details: { isMainFrame: boolean; isSameDocument: boolean }): void => undefined;
    let destroy = (): void => undefined;
    const attempts: string[] = [];
    const reported: unknown[] = [];
    let failDetach = true;
    let markReported = (): void => undefined;
    const failureReported = new Promise<void>((resolve) => {
      markReported = resolve;
    });
    let markRetried = (): void => undefined;
    const detachRetried = new Promise<void>((resolve) => {
      markRetried = resolve;
    });
    const sender = {
      id: 7,
      isDestroyed: () => false,
      send: () => undefined,
      on: (_event: "did-start-navigation", listener: typeof navigate) => {
        navigate = listener;
      },
      once: (_event: "destroyed", listener: typeof destroy) => {
        destroy = listener;
      },
    };
    let sendHandler: ElectronTerminalIpcHandler | undefined;
    registerElectronTerminalIpc({
      ipcMain: {
        handle(channel, handler) {
          if (channel === "openducktor:terminal:send") sendHandler = handler;
        },
      },
      reportLifecycleFailure: (_senderId, cause) => {
        reported.push(cause);
        markReported();
      },
      terminalService: {
        attach: () => Effect.void,
        detach: (terminalId, attachmentId) =>
          Effect.suspend(() => {
            attempts.push(attachmentId);
            if (failDetach) {
              return Effect.fail(
                new TerminalServiceError({
                  code: "close_failed",
                  operation: "detach",
                  message: "Injected lifecycle detach failure",
                  terminalId,
                }),
              );
            }
            markRetried();
            return Effect.void;
          }),
      },
    });
    if (!sendHandler) throw new Error("Expected terminal send handler registration.");
    await sendHandler(
      { sender },
      {
        clientId: "client-a",
        frame: makeAttachFrame(),
      },
    );

    navigate({ isMainFrame: true, isSameDocument: false });
    await failureReported;
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ message: "Injected lifecycle detach failure" });

    failDetach = false;
    destroy();
    await detachRetried;
    expect(attempts).toEqual(["electron:7:client-a:terminal-1", "electron:7:client-a:terminal-1"]);
  });

  test("keeps a failed client available across concurrent sender and client teardown", async () => {
    const attempts: string[] = [];
    let startDetach = (): void => undefined;
    const detachStarted = new Promise<void>((resolve) => {
      startDetach = resolve;
    });
    let releaseDetach = (): void => undefined;
    const blockedDetach = new Promise<void>((resolve) => {
      releaseDetach = resolve;
    });
    let failFirst = true;
    const controller = createElectronTerminalIpcController({
      attach: () => Effect.void,
      detach: (terminalId, attachmentId) =>
        Effect.gen(function* () {
          attempts.push(attachmentId);
          if (attachmentId.includes(":client-a:") && failFirst) {
            failFirst = false;
            startDetach();
            yield* Effect.promise(() => blockedDetach);
            return yield* Effect.fail(
              new TerminalServiceError({
                code: "close_failed",
                operation: "detach",
                message: "Injected concurrent detach failure",
                terminalId,
              }),
            );
          }
        }),
    });
    const sender = { id: 7, isDestroyed: () => false, send: () => undefined };
    const frame = makeAttachFrame();
    await Effect.runPromise(controller.handleFrame(sender, "client-a", frame));
    await Effect.runPromise(controller.handleFrame(sender, "client-b", frame));

    const navigating = Effect.runPromise(controller.detachSender(sender.id));
    await detachStarted;
    const disconnecting = Effect.runPromise(controller.detachClient(sender.id, "client-a"));
    const destroying = Effect.runPromise(controller.detachSender(sender.id));
    releaseDetach();
    const results = await Promise.allSettled([navigating, disconnecting, destroying]);

    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect([...attempts].sort()).toEqual([
      "electron:7:client-a:terminal-1",
      "electron:7:client-a:terminal-1",
      "electron:7:client-b:terminal-1",
    ]);
    await Effect.runPromise(controller.detachSender(sender.id));
    expect(attempts).toHaveLength(3);
  });

  test("keeps live attachments during same-document main-frame navigation", async () => {
    const attachments = new Set<string>();
    const terminalService: TerminalService = {
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
    };
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
    const terminalService: TerminalService = {
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
    };
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
    const terminalService: TerminalService = {
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
    };
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
