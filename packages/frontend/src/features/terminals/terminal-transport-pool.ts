import type { TerminalBridge } from "@/lib/shell-bridge";
import {
  createTerminalTransportController,
  type TerminalTransportController,
} from "./terminal-transport-controller";

type SharedTransport = {
  controller: TerminalTransportController;
  error: string | null;
  owners: Set<(error: string | null) => void>;
};

const transports = new WeakMap<TerminalBridge, SharedTransport>();

export const acquireTerminalTransport = (
  bridge: TerminalBridge,
  onError: (error: string | null) => void,
) => {
  let transport = transports.get(bridge);
  if (!transport) {
    const owners = new Set<(error: string | null) => void>();
    const updateError = (error: string | null): void => {
      shared.error = error;
      for (const owner of owners) owner(error);
    };
    const controller = createTerminalTransportController(
      bridge,
      (state) => {
        if (state === "connected") updateError(null);
      },
      (failure) => updateError(failure.message),
    );
    const shared: SharedTransport = { controller, error: null, owners };
    transport = shared;
    transports.set(bridge, shared);
    void controller.connect().catch(() => undefined);
  }
  const acquired = transport;
  // Each lease owns its callback even when two consumers use the same function.
  const listener = (error: string | null): void => onError(error);
  acquired.owners.add(listener);
  listener(acquired.error);
  let released = false;
  return {
    controller: acquired.controller,
    release: () => {
      if (released) return;
      released = true;
      acquired.owners.delete(listener);
      if (acquired.owners.size > 0) return;
      transports.delete(bridge);
      void acquired.controller.dispose().catch((cause: unknown) => {
        console.error("Failed to disconnect terminal transport.", cause);
      });
    },
  };
};
