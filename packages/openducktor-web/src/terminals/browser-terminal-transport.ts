import { TERMINAL_PROTOCOL_SUBPROTOCOL, type TerminalFailure } from "@openducktor/contracts";
import type { TerminalBridge } from "@openducktor/frontend";
import { Effect } from "effect";
import { getBrowserBackendUrlEffect } from "../browser-config";
import { runWebBoundary } from "../effect/web-errors";
import { ensureLocalHostSessionDedupedEffect } from "../local-host-transport";

const terminalSocketUrl = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/terminal`;
  url.search = "";
  url.hash = "";
  return url.toString();
};

const readTerminalSocketCloseFailure = (event: CloseEvent): TerminalFailure | null => {
  if (event.code === 1000) return null;
  const reason = event.reason.trim();
  return {
    code: "protocol_error",
    message: reason || `Terminal WebSocket closed unexpectedly with code ${event.code}.`,
  };
};

export const createBrowserTerminalBridge = (): TerminalBridge => ({
  connect: (onFrame, onStateChange, onFailure) =>
    runWebBoundary(
      Effect.gen(function* () {
        yield* ensureLocalHostSessionDedupedEffect();
        const baseUrl = yield* getBrowserBackendUrlEffect();
        const socket = yield* Effect.tryPromise({
          try: () =>
            new Promise<WebSocket>((resolve, reject) => {
              const candidate = new WebSocket(
                terminalSocketUrl(baseUrl),
                TERMINAL_PROTOCOL_SUBPROTOCOL,
              );
              candidate.binaryType = "arraybuffer";
              candidate.addEventListener("open", () => resolve(candidate), { once: true });
              candidate.addEventListener(
                "error",
                () => reject(new Error("Terminal WebSocket connection failed.")),
                { once: true },
              );
              candidate.addEventListener(
                "close",
                () => reject(new Error("Terminal WebSocket closed before connecting.")),
                { once: true },
              );
            }),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        });
        socket.addEventListener("message", (event) => {
          if (event.data instanceof ArrayBuffer) onFrame(new Uint8Array(event.data));
        });
        socket.addEventListener("close", (event) => {
          const failure = readTerminalSocketCloseFailure(event);
          if (failure) onFailure(failure);
          onStateChange("disconnected");
        });
        onStateChange("connected");
        return {
          send: async (frame: Uint8Array): Promise<void> => {
            if (socket.readyState !== WebSocket.OPEN) {
              throw new Error("Terminal WebSocket is disconnected.");
            }
            socket.send(frame);
          },
          close: async () => {
            socket.close(1000, "Terminal renderer disconnected.");
            onStateChange("disconnected");
          },
        };
      }),
    ),
});
