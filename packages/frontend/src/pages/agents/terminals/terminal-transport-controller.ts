import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalFailure,
} from "@openducktor/contracts";
import type {
  TerminalBridge,
  TerminalTransportConnection,
  TerminalTransportState,
} from "@/lib/shell-bridge";
import {
  createTerminalTransportChannelRegistry,
  type TerminalFrameListener,
} from "./terminal-transport-channel-registry";

export type { TerminalFrameListener } from "./terminal-transport-channel-registry";

export type TerminalTransportController = ReturnType<typeof createTerminalTransportController>;

type TerminalConnectionState =
  | { status: "disconnected" }
  | {
      status: "connecting";
      generation: number;
      pending: Promise<TerminalTransportConnection>;
    }
  | { status: "connected"; generation: number; connection: TerminalTransportConnection }
  | { status: "disposed" };

export const createTerminalTransportController = (
  bridge: TerminalBridge,
  onStateChange: (state: TerminalTransportState) => void,
  onProtocolFailure: (failure: TerminalFailure) => void = () => undefined,
) => {
  const terminalChannels = createTerminalTransportChannelRegistry();
  let connectionState: TerminalConnectionState = { status: "disconnected" };
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let connectionGeneration = 0;
  const emptyPayload: Uint8Array = new Uint8Array(0);

  const reportConnectionFailure = (cause: unknown): void => {
    onProtocolFailure({
      code: "protocol_error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  };

  const closeConnection = async (
    activeConnection: TerminalTransportConnection | null,
  ): Promise<void> => {
    await activeConnection?.close();
  };

  const activeConnection = (): TerminalTransportConnection | null =>
    connectionState.status === "connected" ? connectionState.connection : null;
  const isDisposed = (): boolean => connectionState.status === "disposed";

  const getConnection = async (): Promise<TerminalTransportConnection> => {
    const state = connectionState;
    if (state.status === "connected") return state.connection;
    if (state.status !== "connecting") throw new Error("Terminal transport is disconnected.");
    const connected = await state.pending;
    if (connectionState.status !== "connected" || connectionState.connection !== connected)
      throw new Error("Terminal transport is disconnected.");
    return connected;
  };

  const send = async (
    message: Parameters<typeof encodeTerminalProtocolFrame>[0]["message"],
    payload: Uint8Array = emptyPayload,
  ): Promise<void> => {
    const connection = await getConnection();
    try {
      await connection.send(encodeTerminalProtocolFrame({ message, payload }));
    } catch (cause) {
      if (connectionState.status === "connected" && connectionState.connection === connection) {
        transitionToDisconnected({ cause });
      }
      throw cause;
    }
  };

  const enqueueTerminalOperation = (
    terminalId: string,
    operation: () => Promise<void>,
  ): Promise<void> => terminalChannels.enqueue(terminalId, operation);

  const attach = (terminalId: string): Promise<void> =>
    enqueueTerminalOperation(terminalId, () =>
      send({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "attach",
        terminalId,
        lastConsumedSequence: terminalChannels.lastConsumedSequence(terminalId),
      }),
    );
  const handleFrame = (frame: Uint8Array): void => {
    const decoded = decodeTerminalProtocolFrame(frame);
    if (
      decoded.message.type === "attach" ||
      decoded.message.type === "input" ||
      decoded.message.type === "resize" ||
      decoded.message.type === "ack" ||
      decoded.message.type === "detach"
    ) {
      throw new Error("Terminal transport received a client-directed frame.");
    }
    if (decoded.message.type === "protocol_error" && !decoded.message.terminalId) {
      transitionToDisconnected({ failure: decoded.message.failure });
      return;
    }
    for (const listener of terminalChannels.listeners(decoded.message.terminalId ?? "")) {
      listener(decoded.message, decoded.payload);
    }
  };

  const scheduleReconnect = (): void => {
    if (connectionState.status !== "disconnected" || reconnectTimer) return;
    const delayMs = reconnectAttempt === 0 ? 0 : Math.min(250 * 2 ** (reconnectAttempt - 1), 2_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void establishConnection(false).catch(() => scheduleReconnect());
    }, delayMs);
  };

  function transitionToDisconnected({
    failure,
    cause,
  }: {
    failure?: TerminalFailure;
    cause?: unknown;
  } = {}): void {
    if (connectionState.status === "disposed" || connectionState.status === "disconnected") return;
    const failedConnection = activeConnection();
    connectionGeneration += 1;
    connectionState = { status: "disconnected" };
    onStateChange("disconnected");
    if (failure) onProtocolFailure(failure);
    if (cause !== undefined) reportConnectionFailure(cause);
    void closeConnection(failedConnection).then(scheduleReconnect, (closeCause) => {
      reportConnectionFailure(closeCause);
      scheduleReconnect();
    });
  }

  const establishConnection = async (replaceExisting: boolean): Promise<void> => {
    if (connectionState.status === "disposed")
      throw new Error("Terminal transport controller is disposed.");
    if (!replaceExisting && connectionState.status !== "disconnected") {
      if (connectionState.status === "connecting") await connectionState.pending;
      return;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connectionGeneration += 1;
    const generation = connectionGeneration;
    const previousConnection = activeConnection();
    connectionState = { status: "disconnected" };
    if (replaceExisting && previousConnection) await closeConnection(previousConnection);
    const pending = Promise.resolve().then(() =>
      bridge.connect(handleFrame, (state) => {
        if (connectionState.status === "disposed" || generation !== connectionGeneration) return;
        if (state === "disconnected") {
          transitionToDisconnected();
        } else {
          onStateChange(state);
        }
      }),
    );
    connectionState = { status: "connecting", generation, pending };
    let connected: TerminalTransportConnection;
    try {
      connected = await pending;
    } catch (cause) {
      if (!isDisposed() && generation === connectionGeneration) {
        reportConnectionFailure(cause);
        connectionState = { status: "disconnected" };
        onStateChange("disconnected");
        scheduleReconnect();
      }
      throw cause;
    }
    if (isDisposed() || generation !== connectionGeneration) {
      await closeConnection(connected);
      return;
    }
    connectionState = { status: "connected", generation, connection: connected };
    const attachments = terminalChannels.activeTerminalIds().map(attach);
    try {
      await Promise.all(attachments);
      reconnectAttempt = 0;
    } catch (cause) {
      transitionToDisconnected({ cause });
      throw cause;
    }
  };

  const connect = (): Promise<void> => establishConnection(true);
  const reportTransportFailure = (cause: unknown): void => {
    transitionToDisconnected({ cause });
  };

  return {
    connect,
    subscribe(terminalId: string, listener: TerminalFrameListener): () => void {
      const shouldAttach = terminalChannels.addListener(terminalId, listener);
      if (shouldAttach && connectionState.status === "connected")
        void attach(terminalId).catch(reportTransportFailure);
      return () => {
        const { lastListenerRemoved, wasClosing } = terminalChannels.removeListener(
          terminalId,
          listener,
        );
        if (lastListenerRemoved && connectionState.status === "connected" && !wasClosing) {
          void enqueueTerminalOperation(terminalId, () =>
            send({
              version: TERMINAL_PROTOCOL_VERSION,
              type: "detach",
              terminalId,
            }),
          ).catch(reportTransportFailure);
        }
      };
    },
    write: (terminalId: string, payload: Uint8Array) =>
      enqueueTerminalOperation(terminalId, () =>
        send({ version: TERMINAL_PROTOCOL_VERSION, type: "input", terminalId }, payload),
      ),
    resize: (terminalId: string, columns: number, rows: number) =>
      enqueueTerminalOperation(terminalId, () =>
        send({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "resize",
          terminalId,
          columns,
          rows,
        }),
      ),
    acknowledge: async (terminalId: string, sequenceEnd: number) => {
      if (!terminalChannels.advanceConsumedSequence(terminalId, sequenceEnd)) return;
      await enqueueTerminalOperation(terminalId, () =>
        send({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "ack",
          terminalId,
          sequenceEnd,
        }),
      );
    },
    async closeTerminal<Result extends { closed: boolean }>(
      terminalId: string,
      closeHostTerminal: () => Promise<Result>,
    ): Promise<Result> {
      terminalChannels.beginClose(terminalId);
      try {
        const result = await closeHostTerminal();
        if (!result.closed) {
          terminalChannels.cancelClose(terminalId);
          return result;
        }
        terminalChannels.completeClose(terminalId);
        return result;
      } catch (cause) {
        terminalChannels.cancelClose(terminalId);
        throw cause;
      }
    },
    releaseEmulator(terminalId: string): void {
      terminalChannels.releaseEmulator(terminalId);
    },
    async dispose(): Promise<void> {
      connectionGeneration += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const connectionToClose = activeConnection();
      connectionState = { status: "disposed" };
      terminalChannels.clear();
      onStateChange("disconnected");
      await closeConnection(connectionToClose);
    },
  };
};
