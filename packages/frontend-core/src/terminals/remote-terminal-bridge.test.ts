import { savedTestAuthorizationStore } from "../../../host-client/src/remote/test-support/authorization";
import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  type RemoteFailure,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalFailure,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { createClientQueryClient } from "../connection/client-query-client";
import { createRemoteHostConnection } from "../recovery/remote-host-connection";
import {
  createChannelTestTransport,
  testRemoteDescriptor,
} from "../test-support/remote-channel-transport";
import { waitForExpectation } from "../test-support/wait-for-expectation";
import { createRemoteTerminalBridge } from "./remote-terminal-bridge";
import { createTerminalTransportController } from "./terminal-transport-controller";

const TERMINAL_ID = "terminal-1";

describe("createRemoteTerminalBridge", () => {
  test("opens the terminal socket after admission and reports its loss", async () => {
    const host = createRemoteFixture();
    const bridge = createRemoteTerminalBridge(host.connection);
    const states: string[] = [];
    const failures: TerminalFailure[] = [];
    const frames: Uint8Array[] = [];
    try {
      const socket = await bridge.connect(
        (frame) => frames.push(frame),
        (state) => states.push(state),
        (failure) => failures.push(failure),
      );
      expect(host.openedHeaders()[0]?.["x-openducktor-connection-id"]).toBeString();
      expect(states).toEqual(["connected"]);

      host.emit(
        serverFrame({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "title",
          terminalId: TERMINAL_ID,
          title: "zsh",
        }),
      );
      expect(frames).toHaveLength(1);

      host.closeSocket({
        code: "transport_failure",
        message: "The socket closed.",
        nextAction: "Reconnect.",
      });
      expect(states).toEqual(["connected", "disconnected"]);
      expect(failures).toEqual([{ code: "protocol_error", message: "The socket closed." }]);
      await socket.close();
      await host.connected();
    } finally {
      await host.connection.remote.disconnect();
    }
  });

  test("gives the controller the reason of a failed socket close", async () => {
    const host = createRemoteFixture();
    const failures: TerminalFailure[] = [];
    const states: string[] = [];
    const controller = createTerminalTransportController(
      createRemoteTerminalBridge(host.connection),
      (state) => states.push(state),
      (failure) => failures.push(failure),
    );
    try {
      await controller.connect();
      host.closeSocket({
        code: "transport_failure",
        message: "The host connection was lost.",
        nextAction: "Reconnect.",
      });

      expect(failures).toEqual([
        { code: "protocol_error", message: "The host connection was lost." },
      ]);
      expect(states.at(-1)).toBe("disconnected");
    } finally {
      await controller.dispose();
      await host.connection.remote.disconnect();
    }
  });

  test("reports a failed socket send as an unknown input delivery", async () => {
    const host = createRemoteFixture();
    const bridge = createRemoteTerminalBridge(host.connection);
    try {
      await host.connected();
      const socket = await bridge.connect(
        () => undefined,
        () => undefined,
        () => undefined,
      );
      host.failSends();
      const failure = await socket.send(new Uint8Array([1])).catch((cause: Error) => cause);
      expect(failure).toBeInstanceOf(RemoteConnectionError);
      expect(failure instanceof RemoteConnectionError && failure.failure.code).toBe(
        "outcome_unknown",
      );
      await socket.close();
      await host.connected();
    } finally {
      await host.connection.remote.disconnect();
    }
  });

  test("holds a reconnect until the attached terminal consumes its snapshot output", async () => {
    const host = createRemoteFixture();
    const controller = createTerminalTransportController(
      createRemoteTerminalBridge(host.connection),
      () => undefined,
    );
    const received: TerminalServerMessage[] = [];
    const stop = controller.subscribe(TERMINAL_ID, (message) => received.push(message));
    try {
      await controller.connect();
      await waitForExpectation(() => expect(host.attachments()).toBe(1));
      expect(host.connection.remote.readState().status).toBe("synchronizing");
      await controller.acknowledge(TERMINAL_ID, 3);
      await host.connected();

      host.closeSocket({ code: "transport_failure", message: "Lost.", nextAction: "Retry." });
      const retry = host.connection.remote.retry();
      await waitForExpectation(() => expect(host.attachments()).toBe(2));
      await Promise.resolve();
      expect(host.connection.remote.readState().status).toBe("synchronizing");

      await controller.acknowledge(TERMINAL_ID, 6);
      await retry;
      expect(host.connection.remote.readState().status).toBe("connected");
      expect(received.filter((message) => message.type === "snapshot")).toHaveLength(2);
    } finally {
      stop();
      await controller.dispose();
      await host.connection.remote.disconnect();
    }
  });
});

const serverFrame = (message: TerminalServerMessage, payload = new Uint8Array(0)): Uint8Array =>
  encodeTerminalProtocolFrame({ message, payload });

const createRemoteFixture = () => {
  const encoder = new TextEncoder();
  const opened: Array<Readonly<Record<string, string>>> = [];
  let onFrame: ((frame: Uint8Array) => void) | null = null;
  let onClose: ((failure?: RemoteFailure) => void) | null = null;
  let sendsFail = false;
  let attachments = 0;
  // Each attach gets a snapshot that ends three bytes after the last one.
  let snapshotEnd = 0;
  const { transport } = createChannelTestTransport({
    descriptor: () =>
      testRemoteDescriptor({ appVersion: "host-release", hostInstanceId: "host-instance-1" }),
    openTerminal: async (_url, protocol, headers, _signal, frameListener, closeListener) => {
      expect(protocol).toBe(TERMINAL_PROTOCOL_SUBPROTOCOL);
      opened.push(headers);
      onFrame = frameListener;
      onClose = closeListener;
      return {
        send: async (bytes) => {
          if (sendsFail) throw new Error("The socket buffer is gone.");
          const { message } = decodeTerminalProtocolFrame(bytes);
          if (message.type !== "attach") return;
          attachments += 1;
          const start = snapshotEnd;
          snapshotEnd += 3;
          queueMicrotask(() => {
            onFrame?.(
              serverFrame({
                version: TERMINAL_PROTOCOL_VERSION,
                type: "snapshot",
                terminalId: TERMINAL_ID,
                earliestRetainedSequence: 0,
                snapshotSequenceEnd: snapshotEnd,
                lifecycle: "running",
                title: "zsh",
                complete: true,
              }),
            );
            onFrame?.(
              serverFrame(
                {
                  version: TERMINAL_PROTOCOL_VERSION,
                  type: "output",
                  terminalId: TERMINAL_ID,
                  sequenceStart: start,
                  sequenceEnd: snapshotEnd,
                  replay: true,
                },
                encoder.encode("abc"),
              ),
            );
          });
        },
        close: () => undefined,
      };
    },
  });
  const connection = createRemoteHostConnection({
    authorizationStore: savedTestAuthorizationStore(),
    clientKind: "mobile",
    endpoint: "https://host.test/remote",
    version: "mobile-release",
    transport,
    queryClient: createClientQueryClient(),
  });
  return {
    connection,
    openedHeaders: () => opened,
    attachments: () => attachments,
    connected: () =>
      waitForExpectation(() => expect(connection.remote.readState().status).toBe("connected")),
    emit: (bytes: Uint8Array) => onFrame?.(bytes),
    closeSocket: (failure: RemoteFailure) => onClose?.(failure),
    failSends: () => {
      sendsFail = true;
    },
  };
};
