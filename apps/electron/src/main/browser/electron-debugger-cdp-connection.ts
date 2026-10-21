import {
  type CdpConnection,
  type CdpEvent,
  type CdpPayload,
  CdpProtocolError,
  createBrowserEndSignal,
} from "@openducktor/host";

/** An Electron event that a handler can cancel. */
export type ElectronCancelableEvent = { preventDefault(): void };

type DebuggerMessageListener = (
  event: ElectronCancelableEvent,
  method: string,
  params: CdpPayload,
  sessionId: string,
) => void;
type DebuggerDetachListener = (event: ElectronCancelableEvent, reason: string) => void;

/**
 * The `webContents.debugger` API that the browser engine uses. Electron builds each result and
 * each event parameter object from a CDP JSON message, so the values are CDP payloads.
 */
export type ElectronCdpDebugger = {
  attach(protocolVersion?: string): void;
  isAttached(): boolean;
  sendCommand(method: string, commandParams?: CdpPayload, sessionId?: string): Promise<CdpPayload>;
  on(event: "message", listener: DebuggerMessageListener): void;
  on(event: "detach", listener: DebuggerDetachListener): void;
  removeListener(event: "message", listener: DebuggerMessageListener): void;
  removeListener(event: "detach", listener: DebuggerDetachListener): void;
};

export type ElectronDebuggerCdpConnection = CdpConnection & {
  /** Ends the connection: pending callers fail, and the session listeners stop. */
  close(reason: string): void;
};

/**
 * One flat CDP connection over the Electron debugger of one page. An empty session ID addresses
 * the root session of the page. Each `Target.attachToTarget` with `flatten: true` adds a session.
 */
export const createElectronDebuggerCdpConnection = (
  debuggerApi: ElectronCdpDebugger,
): ElectronDebuggerCdpConnection => {
  const listeners = new Set<(event: CdpEvent) => void>();
  const closed = createBrowserEndSignal<string>();

  const onMessage: DebuggerMessageListener = (_event, method, params, sessionId) => {
    const cdpEvent: CdpEvent = { method, params, sessionId };
    for (const listener of Array.from(listeners)) {
      listener(cdpEvent);
    }
  };

  const close = (reason: string): void => {
    if (closed.isEnded()) {
      return;
    }
    debuggerApi.removeListener("message", onMessage);
    debuggerApi.removeListener("detach", onDetach);
    closed.end(reason);
    listeners.clear();
  };

  const onDetach: DebuggerDetachListener = (_event, reason) => close(reason);

  debuggerApi.on("message", onMessage);
  debuggerApi.on("detach", onDetach);

  return {
    request(method, params, sessionId) {
      const closedReason = closed.reason();
      if (closedReason !== null) {
        return Promise.reject(
          new CdpProtocolError(method, `CDP connection closed: ${closedReason}`, null),
        );
      }
      return debuggerApi
        .sendCommand(method, params ?? {}, sessionId.length > 0 ? sessionId : undefined)
        .catch((cause: Error) => {
          // Electron reports the protocol error message but not its code.
          throw new CdpProtocolError(method, cause.message, null);
        });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose: closed.onEnded,
    isClosed: closed.isEnded,
    close,
  };
};
