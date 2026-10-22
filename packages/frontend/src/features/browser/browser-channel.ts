import {
  type BrowserClientMessage,
  type BrowserServerMessage,
  decodeBrowserServerMessage,
  encodeBrowserChannelMessage,
} from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { BrowserChannelConnection, WebviewBrowserBridge } from "@/lib/shell-bridge";

export type BrowserChannelStatus = "connecting" | "connected" | "disconnected";

export type BrowserChannelListener = (message: BrowserServerMessage) => void;

const FIRST_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 2_000;

/**
 * The browser channel of an Electron window. It reconnects after a lost connection with a short
 * backoff, and `stop` ends it until the next `connect`, so a remounted provider can start it again.
 * The channel drops a message while it is not connected. The owners of anchors send them again
 * when the channel connects, and a picker hover for a lost connection has no page to reach.
 */
export const createBrowserChannel = (bridge: Pick<WebviewBrowserBridge, "connect">) => {
  let connection: BrowserChannelConnection | null = null;
  let status: BrowserChannelStatus = "disconnected";
  let failure: string | null = null;
  let stopped = true;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const listeners = new Set<BrowserChannelListener>();
  const statusListeners = new Set<() => void>();

  const setStatus = (next: BrowserChannelStatus, nextFailure: string | null = failure): void => {
    status = next;
    failure = nextFailure;
    for (const listener of Array.from(statusListeners)) listener();
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer !== null) return;
    const delay =
      attempt === 0
        ? 0
        : Math.min(FIRST_RECONNECT_DELAY_MS * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const handleMessage = (bytes: Uint8Array): void => {
    const message = decodeBrowserServerMessage(bytes);
    for (const listener of Array.from(listeners)) listener(message);
  };

  const connect = async (): Promise<void> => {
    if (status !== "disconnected") return;
    stopped = false;
    const connectGeneration = ++generation;
    setStatus("connecting");
    let lost = false;
    try {
      // The bridges report `connected` before `connect` returns the connection. The channel says
      // that it is connected only after it keeps the connection, because the status listeners send
      // their anchors at once.
      const opened = await bridge.connect(
        (message) => {
          if (connectGeneration === generation) handleMessage(message);
        },
        (state) => {
          if (connectGeneration !== generation || state === "connected") return;
          lost = true;
          connection = null;
          setStatus("disconnected");
          scheduleReconnect();
        },
        (channelFailure) => {
          if (connectGeneration === generation) failure = channelFailure.message;
        },
      );
      if (lost) return;
      if (stopped || connectGeneration !== generation) {
        await opened.close();
        return;
      }
      connection = opened;
      attempt = 0;
      setStatus("connected", null);
    } catch (cause) {
      if (connectGeneration !== generation) return;
      connection = null;
      setStatus("disconnected", errorMessage(cause));
      scheduleReconnect();
    }
  };

  return {
    connect,
    status: () => status,
    failure: () => failure,
    send(message: BrowserClientMessage): void {
      if (status !== "connected" || connection === null) return;
      void connection.send(encodeBrowserChannelMessage(message)).catch((cause: unknown) => {
        failure = errorMessage(cause);
      });
    },
    subscribe(listener: BrowserChannelListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus(listener: () => void): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    /** Closes the connection and stops reconnects until the next `connect`. */
    async stop(): Promise<void> {
      stopped = true;
      generation += 1;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      attempt = 0;
      const closing = connection;
      connection = null;
      setStatus("disconnected", null);
      await closing?.close();
    },
  };
};

export type BrowserChannel = ReturnType<typeof createBrowserChannel>;
