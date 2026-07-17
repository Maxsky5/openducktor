import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalFailure,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import type {
  TerminalBridge,
  TerminalTransportConnection,
  TerminalTransportState,
} from "@/lib/shell-bridge";

export type TerminalFrameListener = (message: TerminalServerMessage, payload: Uint8Array) => void;

export type TerminalTransportController = ReturnType<typeof createTerminalTransportController>;

export const createTerminalTransportController = (
  bridge: TerminalBridge,
  onStateChange: (state: TerminalTransportState) => void,
  onProtocolFailure: (failure: TerminalFailure) => void = () => undefined,
) => {
  const listeners = new Map<string, Set<TerminalFrameListener>>();
  const consumedSequences = new Map<string, number>();
  const terminalOperationQueues = new Map<string, Promise<void>>();
  const closingTerminals = new Set<string>();
  const discardedTerminalOperations = new Set<string>();
  let connection: TerminalTransportConnection | null = null;
  let pendingConnection: Promise<TerminalTransportConnection> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let connectionGeneration = 0;
  let disposed = false;
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

  const getConnection = async (): Promise<TerminalTransportConnection> => {
    if (connection) return connection;
    const pending = pendingConnection;
    if (!pending) throw new Error("Terminal transport is disconnected.");
    const connected = await pending;
    if (pendingConnection !== pending && connection !== connected)
      throw new Error("Terminal transport is disconnected.");
    return connected;
  };

  const send = async (
    message: Parameters<typeof encodeTerminalProtocolFrame>[0]["message"],
    payload: Uint8Array = emptyPayload,
  ): Promise<void> => {
    const activeConnection = await getConnection();
    await activeConnection.send(encodeTerminalProtocolFrame({ message, payload }));
  };

  const enqueueTerminalOperation = (
    terminalId: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    const previous = terminalOperationQueues.get(terminalId);
    const run = (): Promise<void> =>
      discardedTerminalOperations.has(terminalId) ? Promise.resolve() : operation();
    const pending = previous ? previous.then(run) : run();
    terminalOperationQueues.set(terminalId, pending);
    const clearCompletedOperation = (): void => {
      if (terminalOperationQueues.get(terminalId) === pending) {
        terminalOperationQueues.delete(terminalId);
        if (!listeners.has(terminalId)) discardedTerminalOperations.delete(terminalId);
      }
    };
    void pending.then(clearCompletedOperation, clearCompletedOperation);
    return pending;
  };

  const attach = (terminalId: string): Promise<void> =>
    enqueueTerminalOperation(terminalId, () =>
      send({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "attach",
        terminalId,
        lastConsumedSequence: consumedSequences.get(terminalId) ?? null,
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
      const activeConnection = connection;
      connection = null;
      pendingConnection = null;
      onStateChange("disconnected");
      onProtocolFailure(decoded.message.failure);
      void closeConnection(activeConnection).then(scheduleReconnect, reportConnectionFailure);
      return;
    }
    for (const listener of listeners.get(decoded.message.terminalId ?? "") ?? []) {
      listener(decoded.message, decoded.payload);
    }
  };

  const scheduleReconnect = (): void => {
    if (disposed || connection || pendingConnection || reconnectTimer) return;
    const delayMs = reconnectAttempt === 0 ? 0 : Math.min(250 * 2 ** (reconnectAttempt - 1), 2_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void establishConnection(false).catch(() => scheduleReconnect());
    }, delayMs);
  };

  const establishConnection = async (replaceExisting: boolean): Promise<void> => {
    if (disposed) throw new Error("Terminal transport controller is disposed.");
    if (!replaceExisting && (connection || pendingConnection)) {
      if (pendingConnection) await pendingConnection;
      return;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connectionGeneration += 1;
    const generation = connectionGeneration;
    const previousConnection = connection;
    connection = null;
    pendingConnection = null;
    if (replaceExisting && previousConnection) await closeConnection(previousConnection);
    const pending = bridge.connect(handleFrame, (state) => {
      if (disposed || generation !== connectionGeneration) return;
      onStateChange(state);
      if (state === "disconnected") {
        connection = null;
        pendingConnection = null;
        scheduleReconnect();
      }
    });
    pendingConnection = pending;
    let connected: TerminalTransportConnection;
    try {
      connected = await pending;
    } catch (cause) {
      if (!disposed && generation === connectionGeneration) {
        pendingConnection = null;
        onStateChange("disconnected");
        scheduleReconnect();
      }
      throw cause;
    }
    if (disposed || generation !== connectionGeneration) {
      await closeConnection(connected);
      return;
    }
    connection = connected;
    pendingConnection = null;
    reconnectAttempt = 0;
    await Promise.all([...listeners.keys()].map((terminalId) => attach(terminalId)));
  };

  const connect = (): Promise<void> => establishConnection(true);
  const reportTransportFailure = (cause: unknown): void => {
    if (disposed) return;
    const activeConnection = connection;
    connection = null;
    pendingConnection = null;
    onStateChange("disconnected");
    reportConnectionFailure(cause);
    void closeConnection(activeConnection).then(scheduleReconnect, reportConnectionFailure);
  };

  return {
    connect,
    subscribe(terminalId: string, listener: TerminalFrameListener): () => void {
      const current = listeners.get(terminalId) ?? new Set<TerminalFrameListener>();
      const shouldAttach = current.size === 0;
      current.add(listener);
      listeners.set(terminalId, current);
      if (shouldAttach && connection) void attach(terminalId).catch(reportTransportFailure);
      return () => {
        const terminalListeners = listeners.get(terminalId);
        terminalListeners?.delete(listener);
        if (terminalListeners?.size === 0) {
          listeners.delete(terminalId);
          const isClosing = closingTerminals.delete(terminalId);
          if (!terminalOperationQueues.has(terminalId))
            discardedTerminalOperations.delete(terminalId);
          if (connection && !isClosing) {
            void enqueueTerminalOperation(terminalId, () =>
              send({
                version: TERMINAL_PROTOCOL_VERSION,
                type: "detach",
                terminalId,
              }),
            ).catch(reportTransportFailure);
          }
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
      const consumedSequence = consumedSequences.get(terminalId);
      if (consumedSequence !== undefined && sequenceEnd <= consumedSequence) return;
      consumedSequences.set(terminalId, sequenceEnd);
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
      closingTerminals.add(terminalId);
      try {
        const result = await closeHostTerminal();
        if (!result.closed) {
          closingTerminals.delete(terminalId);
          return result;
        }
        discardedTerminalOperations.add(terminalId);
        consumedSequences.delete(terminalId);
        if (!listeners.has(terminalId)) closingTerminals.delete(terminalId);
        return result;
      } catch (cause) {
        closingTerminals.delete(terminalId);
        throw cause;
      }
    },
    releaseEmulator(terminalId: string): void {
      if ((listeners.get(terminalId)?.size ?? 0) <= 1) consumedSequences.delete(terminalId);
    },
    async dispose(): Promise<void> {
      disposed = true;
      connectionGeneration += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const activeConnection = connection;
      connection = null;
      pendingConnection = null;
      listeners.clear();
      terminalOperationQueues.clear();
      closingTerminals.clear();
      discardedTerminalOperations.clear();
      onStateChange("disconnected");
      await closeConnection(activeConnection);
    },
  };
};
