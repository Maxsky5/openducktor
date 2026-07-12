import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
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
) => {
  const listeners = new Map<string, Set<TerminalFrameListener>>();
  const consumedSequences = new Map<string, number>();
  let connection: TerminalTransportConnection | null = null;
  const emptyPayload: Uint8Array = new Uint8Array(0);

  const send = async (
    message: Parameters<typeof encodeTerminalProtocolFrame>[0]["message"],
    payload: Uint8Array = emptyPayload,
  ): Promise<void> => {
    if (!connection) throw new Error("Terminal transport is disconnected.");
    await connection.send(encodeTerminalProtocolFrame({ message, payload }));
  };

  const attach = async (terminalId: string): Promise<void> => {
    await send({
      version: TERMINAL_PROTOCOL_VERSION,
      type: "attach",
      terminalId,
      lastConsumedSequence: consumedSequences.get(terminalId) ?? null,
    });
  };
  const reportTransportFailure = (): void => onStateChange("disconnected");

  const connect = async (): Promise<void> => {
    connection?.close();
    connection = await bridge.connect((frame) => {
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
      for (const listener of listeners.get(decoded.message.terminalId ?? "") ?? []) {
        listener(decoded.message, decoded.payload);
      }
    }, onStateChange);
    for (const terminalId of listeners.keys()) await attach(terminalId);
  };

  return {
    connect,
    async reconnect(): Promise<void> {
      await connect();
    },
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
          if (connection) {
            void send({
              version: TERMINAL_PROTOCOL_VERSION,
              type: "detach",
              terminalId,
            }).catch(reportTransportFailure);
          }
        }
      };
    },
    write: (terminalId: string, payload: Uint8Array) =>
      send({ version: TERMINAL_PROTOCOL_VERSION, type: "input", terminalId }, payload),
    resize: (terminalId: string, columns: number, rows: number) =>
      send({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "resize",
        terminalId,
        columns,
        rows,
      }),
    acknowledge: async (terminalId: string, sequenceEnd: number) => {
      consumedSequences.set(terminalId, sequenceEnd);
      await send({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "ack",
        terminalId,
        sequenceEnd,
      });
    },
    dispose(): void {
      connection?.close();
      connection = null;
      listeners.clear();
      onStateChange("disconnected");
    },
  };
};
