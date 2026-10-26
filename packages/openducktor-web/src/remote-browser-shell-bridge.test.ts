import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { expect, test } from "bun:test";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  TERMINAL_PROTOCOL_VERSION,
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  type RemoteHostDescriptor,
  type RemoteNegotiationResult,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import type { RemoteHttpResponse, RemoteTransport } from "@openducktor/host-client/remote";
import { createTerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import { createRemoteShellBridge } from "@openducktor/frontend/lib/remote/shell-bridge";
import { createUnavailableShellBridge } from "@openducktor/frontend/lib/shell-bridge";

test.each(["restored", "lost", "failure"])(
  "selected terminal recovery joins the browser connection barrier (%s)",
  async (result) => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const page = Object.assign(new EventTarget(), { location: { origin: "https://host.test" } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: page });
    Object.defineProperty(globalThis, "document", { configurable: true, value: new EventTarget() });
    const host: RemoteHostDescriptor = {
      shell: "web",
      appVersion: "test-host",
      hostInstanceId: "host-a",
      accessPolicy: "network_reach",
      protocols: [
        { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
      ],
    };
    const json = (
      value: RemoteHostDescriptor | RemoteNegotiationResult | null,
      status = 200,
    ): RemoteHttpResponse => ({
      status,
      headers: {},
      body: (async function* () {
        if (status !== 204) yield new TextEncoder().encode(JSON.stringify(value));
      })(),
    });
    const socketStarted = Promise.withResolvers<void>();
    const socketSetup = Promise.withResolvers<void>();
    const attachmentSent = Promise.withResolvers<void>();
    const frames: Uint8Array[] = [];
    let sockets = 0;
    let receive!: (frame: Uint8Array) => void;
    const transport: RemoteTransport = {
      async request(method, url, _headers, signal) {
        if (method === "DELETE") return json(null, 204);
        if (url.endsWith("/connections"))
          return json({
            status: "accepted",
            host,
            connectionId: crypto.randomUUID(),
            protocolVersion: REMOTE_PROTOCOL_VERSION,
            missingOptionalCapabilities: [],
          });
        if (url.endsWith("/events"))
          return {
            status: 200,
            headers: {},
            body: (async function* () {
              yield new TextEncoder().encode(
                `event: replay-complete\ndata: ${JSON.stringify({ hostChanged: false, gaps: [] })}\n\nevent: notification-frame\ndata: ${JSON.stringify({ type: "attached", cursor: { epoch: crypto.randomUUID(), sequence: 0 }, reason: "new", health: [] })}\n\n`,
              );
              await new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => resolve(), { once: true });
                if (signal.aborted) resolve();
              });
            })(),
          };
        return json(host);
      },
      async openTerminal(_url, _headers, _signal, onFrame) {
        sockets += 1;
        receive = onFrame;
        if (sockets === 2) {
          socketStarted.resolve();
          await socketSetup.promise;
        }
        return {
          send: async (frame) => {
            frames.push(frame);
            if (sockets === 2 && decodeTerminalProtocolFrame(frame).message.type === "attach")
              attachmentSent.resolve();
          },
          close: () => {},
        };
      },
    };
    let controller: ReturnType<typeof createTerminalTransportController> | undefined;
    let bridge: ReturnType<typeof createRemoteShellBridge> | undefined;
    try {
      bridge = createRemoteShellBridge({
        endpoint: "https://host.test/remote",
        version: "test-browser",
        transport,
        notifications: createUnavailableShellBridge().notifications,
        queryClient: createClientQueryClient(),
      });
      const connection = bridge.remoteConnection!;
      const initial = Promise.withResolvers<void>();
      const stop = connection.subscribeState((state) => {
        if (state.status === "connected") initial.resolve();
      });
      await initial.promise;
      stop();
      const received: TerminalServerMessage[] = [];
      controller = createTerminalTransportController(bridge.terminals, () => {});
      controller.subscribe("terminal-1", (message) => received.push(message));
      await controller.connect();
      await controller.acknowledge("terminal-1", 2);
      const retry = connection.retry();
      const outcome = retry.then(
        () => null,
        (cause: unknown) => cause,
      );
      await socketStarted.promise;
      await Bun.sleep(0);
      expect(connection.readState().status).toBe("synchronizing");
      socketSetup.resolve();
      await attachmentSent.promise;
      const emit = (message: TerminalServerMessage, payload = new Uint8Array()) =>
        receive(encodeTerminalProtocolFrame({ message, payload }));
      if (result === "restored") {
        emit({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "snapshot",
          terminalId: "terminal-1",
          snapshotSequenceEnd: 4,
          earliestRetainedSequence: 0,
          lifecycle: "running",
          title: "Terminal",
          complete: true,
        });
        emit(
          {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "output",
            terminalId: "terminal-1",
            sequenceStart: 2,
            sequenceEnd: 4,
            replay: true,
          },
          new Uint8Array([3, 4]),
        );
        await Bun.sleep(0);
        expect(connection.readState().status).toBe("synchronizing");
        await controller.acknowledge("terminal-1", 4);
      } else {
        emit({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "protocol_error",
          terminalId: "terminal-1",
          failure: {
            code: result === "lost" ? "terminal_forgotten" : "protocol_error",
            message: "Terminal restoration failed.",
          },
        });
      }
      const cause = await outcome;
      if (result === "failure") {
        expect(cause).toMatchObject({ failure: { code: "synchronization_failed" } });
        // A failed synchronization keeps its failure and retries by itself.
        expect(connection.readState()).toMatchObject({
          status: "disconnected",
          failure: { code: "synchronization_failed" },
        });
      } else {
        expect(cause).toBeNull();
        expect(connection.readState().status).toBe("connected");
        if (result === "lost")
          expect(received.at(-1)).toMatchObject({ failure: { code: "terminal_forgotten" } });
      }
      const attachments = frames
        .map(decodeTerminalProtocolFrame)
        .filter(({ message }) => message.type === "attach");
      expect(attachments).toHaveLength(2);
      expect(attachments[1]?.message).toMatchObject({ lastConsumedSequence: 2 });
      expect(
        frames.map(decodeTerminalProtocolFrame).some(({ message }) => message.type === "input"),
      ).toBe(false);
    } finally {
      socketSetup.resolve();
      await controller?.dispose();
      await bridge?.dispose?.();
      bridge?.notifications.dispose();
      await Bun.sleep(0);
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  },
);
