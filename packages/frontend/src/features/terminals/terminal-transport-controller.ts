import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_MAX_INPUT_BYTES,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalFailure,
  isTerminalClientMessage,
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
import { createTerminalActivityStore } from "./terminal-activity-store";
import { TERMINAL_RECOVERY_TIMEOUT_MS } from "./constants";

export type { TerminalFrameListener } from "./terminal-transport-channel-registry";

export type TerminalTransportController = ReturnType<typeof createTerminalTransportController>;

const splitTerminalInput = (payload: Uint8Array): Uint8Array[] => {
  if (payload.byteLength === 0) return [payload];
  return Array.from(
    { length: Math.ceil(payload.byteLength / TERMINAL_PROTOCOL_MAX_INPUT_BYTES) },
    (_, index) => {
      const offset = index * TERMINAL_PROTOCOL_MAX_INPUT_BYTES;
      return payload.subarray(offset, offset + TERMINAL_PROTOCOL_MAX_INPUT_BYTES);
    },
  );
};

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
  const activity = createTerminalActivityStore();
  const activityListeners = new Set<() => void>();
  // Each attach captures a finite snapshot boundary. Later output does not extend recovery.
  const recoveries = new Map<
    string,
    { boundary: number | null; lost: boolean; failure: Error | null }
  >();
  const recoveryListeners = new Set<() => void>();
  const notifyRecovery = () => {
    for (const listener of recoveryListeners) listener();
  };
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
    const frame = encodeTerminalProtocolFrame({ message, payload });
    const connection = await getConnection();
    try {
      await connection.send(frame);
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

  const attach = (terminalId: string): Promise<void> => {
    recoveries.set(terminalId, { boundary: null, lost: false, failure: null });
    return enqueueTerminalOperation(terminalId, () =>
      send({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "attach",
        terminalId,
        lastConsumedSequence: terminalChannels.lastConsumedSequence(terminalId),
      }),
    );
  };
  const handleFrame = (frame: Uint8Array): void => {
    const decoded = decodeTerminalProtocolFrame(frame);
    if (isTerminalClientMessage(decoded.message)) {
      throw new Error("Terminal transport received a client-directed frame.");
    }
    if (
      decoded.message.type === "activity_snapshot_start" ||
      decoded.message.type === "activity_snapshot_end" ||
      decoded.message.type === "activity_updated" ||
      decoded.message.type === "activity_removed"
    ) {
      activity.apply(decoded.message);
      return;
    }
    if (decoded.message.type === "protocol_error" && !decoded.message.terminalId) {
      transitionToDisconnected({ failure: decoded.message.failure });
      return;
    }
    for (const listener of terminalChannels.listeners(decoded.message.terminalId ?? "")) {
      listener(decoded.message, decoded.payload);
    }
    const recovery = recoveries.get(decoded.message.terminalId ?? "");
    if (recovery) {
      if (decoded.message.type === "snapshot")
        recovery.boundary = decoded.message.snapshotSequenceEnd;
      else if (decoded.message.type === "terminal_forgotten") recovery.lost = true;
      else if (decoded.message.type === "protocol_error") {
        if (["terminal_forgotten", "terminal_not_found"].includes(decoded.message.failure.code))
          recovery.lost = true;
        else recovery.failure = new Error(decoded.message.failure.message);
      } else if (decoded.message.type === "output_overflow") {
        recovery.failure = new Error(
          "Terminal output overflowed. Close this tab and create a new terminal.",
        );
      }
      notifyRecovery();
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
    recoveries.clear();
    notifyRecovery();
    activity.disconnected(failure?.message ?? (cause instanceof Error ? cause.message : undefined));
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
      bridge.connect(
        (frame) => {
          if (!isDisposed() && generation === connectionGeneration) handleFrame(frame);
        },
        (state) => {
          if (connectionState.status === "disposed" || generation !== connectionGeneration) return;
          if (state === "disconnected") {
            transitionToDisconnected();
          } else {
            onStateChange(state);
          }
        },
        (failure) => {
          if (connectionState.status === "disposed" || generation !== connectionGeneration) return;
          transitionToDisconnected({ failure });
        },
      ),
    );
    connectionState = { status: "connecting", generation, pending };
    let connected: TerminalTransportConnection;
    try {
      connected = await pending;
    } catch (cause) {
      if (!isDisposed() && generation === connectionGeneration) {
        reportConnectionFailure(cause);
        connectionState = { status: "disconnected" };
        activity.disconnected(cause instanceof Error ? cause.message : String(cause));
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
    if (activityListeners.size > 0)
      attachments.push(send({ version: TERMINAL_PROTOCOL_VERSION, type: "observe_activity" }));
    try {
      await Promise.all(attachments);
      reconnectAttempt = 0;
    } catch (cause) {
      transitionToDisconnected({ cause });
      throw cause;
    }
  };

  const connect = (): Promise<void> => establishConnection(true);
  const stopRecovery = bridge.subscribeRecovery?.((signal) => {
    const required = terminalChannels.activeTerminalIds();
    if (required.length === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let established = false;
      const finish = (cause?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        recoveryListeners.delete(check);
        if (cause !== undefined) reject(cause);
        else resolve();
      };
      const aborted = () => finish(signal.reason);
      const check = () => {
        if (!established) return;
        if (connectionState.status !== "connected") {
          finish(new Error("Terminal transport disconnected during recovery."));
          return;
        }
        for (const terminalId of required) {
          if (terminalChannels.listeners(terminalId).size === 0) continue;
          const recovery = recoveries.get(terminalId);
          if (recovery?.failure) {
            finish(recovery.failure);
            return;
          }
          if (recovery?.lost) continue;
          if (
            recovery?.boundary === null ||
            recovery === undefined ||
            (terminalChannels.lastConsumedSequence(terminalId) ?? 0) < recovery.boundary
          )
            return;
        }
        finish();
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "Terminal restoration timed out. Check the host and WebSocket proxy, then retry.",
            ),
          ),
        TERMINAL_RECOVERY_TIMEOUT_MS,
      );
      recoveryListeners.add(check);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      void establishConnection(false).then(() => {
        established = true;
        check();
      }, finish);
    });
  });
  const reportTransportFailure = (cause: unknown): void => {
    transitionToDisconnected({ cause });
  };
  const cancelClose = (terminalId: string): void => {
    const shouldDetach = terminalChannels.cancelClose(terminalId);
    if (!shouldDetach || connectionState.status !== "connected") return;
    void enqueueTerminalOperation(terminalId, () =>
      send({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "detach",
        terminalId,
      }),
    ).catch(reportTransportFailure);
  };

  return {
    connect,
    readActivity: activity.read,
    subscribeActivity(listener: () => void): () => void {
      const first = activityListeners.size === 0;
      activityListeners.add(listener);
      const stop = activity.subscribe(listener);
      if (first && connectionState.status === "connected") {
        activity.loading();
        void send({ version: TERMINAL_PROTOCOL_VERSION, type: "observe_activity" }).catch(
          reportTransportFailure,
        );
      }
      return () => {
        stop();
        activityListeners.delete(listener);
        if (activityListeners.size === 0 && connectionState.status === "connected")
          void send({ version: TERMINAL_PROTOCOL_VERSION, type: "unobserve_activity" }).catch(
            reportTransportFailure,
          );
      };
    },
    subscribe(terminalId: string, listener: TerminalFrameListener): () => void {
      const shouldAttach = terminalChannels.addListener(terminalId, listener);
      if (shouldAttach && connectionState.status === "connected")
        void attach(terminalId).catch(reportTransportFailure);
      return () => {
        const { lastListenerRemoved, wasClosing } = terminalChannels.removeListener(
          terminalId,
          listener,
        );
        if (lastListenerRemoved) {
          recoveries.delete(terminalId);
          notifyRecovery();
        }
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
      enqueueTerminalOperation(terminalId, async () => {
        const inputMessage = {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "input" as const,
          terminalId,
        };
        await splitTerminalInput(payload).reduce(
          (previousSend, chunk) => previousSend.then(() => send(inputMessage, chunk)),
          Promise.resolve(),
        );
      }),
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
      notifyRecovery();
    },
    async closeTerminal<Result extends { closed: boolean }>(
      terminalId: string,
      closeHostTerminal: () => Promise<Result>,
    ): Promise<Result> {
      terminalChannels.beginClose(terminalId);
      try {
        const result = await closeHostTerminal();
        if (!result.closed) {
          cancelClose(terminalId);
          return result;
        }
        terminalChannels.completeClose(terminalId);
        return result;
      } catch (cause) {
        cancelClose(terminalId);
        throw cause;
      }
    },
    releaseEmulator(terminalId: string): void {
      terminalChannels.releaseEmulator(terminalId);
    },
    async dispose(): Promise<void> {
      stopRecovery?.();
      connectionGeneration += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const connectionToClose = activeConnection();
      connectionState = { status: "disposed" };
      notifyRecovery();
      recoveries.clear();
      terminalChannels.clear();
      activity.clear();
      activityListeners.clear();
      onStateChange("disconnected");
      await closeConnection(connectionToClose);
    },
  };
};
