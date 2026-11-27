import { TERMINAL_PROTOCOL_SUBPROTOCOL, type TerminalFailure } from "@openducktor/contracts";
import type { TerminalBridge } from "@openducktor/frontend-core/terminals/terminal-bridge";
import { HostUnreachableError } from "@openducktor/host-client";
import { Effect } from "effect";
import { getBrowserBackendUrlEffect } from "../browser-config";
import { runWebBoundary } from "@openducktor/remote-host/effect/web-errors";
import { ensureLocalHostSessionDedupedEffect, hostSocketUrl } from "../local-host-transport";

/** A lost connection closes without a close frame (1006). The connection indicator reports it. */
const readTerminalSocketCloseFailure = (event: CloseEvent): TerminalFailure | null => {
  if (event.code === 1000 || event.code === 1006) return null;
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
                hostSocketUrl(baseUrl, "terminal"),
                TERMINAL_PROTOCOL_SUBPROTOCOL,
              );
              candidate.binaryType = "arraybuffer";
              candidate.addEventListener("open", () => resolve(candidate), { once: true });
              candidate.addEventListener(
                "error",
                () =>
                  reject(
                    new HostUnreachableError(new Error("Terminal WebSocket connection failed.")),
                  ),
                { once: true },
              );
              candidate.addEventListener(
                "close",
                () =>
                  reject(
                    new HostUnreachableError(
                      new Error("Terminal WebSocket closed before connecting."),
                    ),
                  ),
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
            socket.send(frame.slice());
          },
          close: async () => {
            socket.close(1000, "Terminal renderer disconnected.");
            onStateChange("disconnected");
          },
        };
      }),
    ),
});
