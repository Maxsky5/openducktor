import type { TerminalFailure } from "@openducktor/contracts";
import { useCallback, useEffect, useState } from "react";
import type { TerminalBridge } from "@/lib/shell-bridge";
import {
  createTerminalTransportController,
  type TerminalTransportController,
} from "./terminal-transport-controller";

type ActiveController = {
  bridge: TerminalBridge;
  controller: TerminalTransportController;
};

export const useTerminalTransport = (
  bridge: TerminalBridge,
): { controller: TerminalTransportController | null; transportError: string | null } => {
  const [activeController, setActiveController] = useState<ActiveController | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const handleStateChange = useCallback((state: "connected" | "disconnected"): void => {
    if (state === "connected") setTransportError(null);
  }, []);
  const handleProtocolFailure = useCallback((failure: TerminalFailure): void => {
    setTransportError(failure.message);
  }, []);

  useEffect(() => {
    setTransportError(null);
    const controller = createTerminalTransportController(
      bridge,
      handleStateChange,
      handleProtocolFailure,
    );
    setActiveController({ bridge, controller });
    void controller.connect().catch(() => undefined);
    return () => {
      void controller.dispose().catch((cause: unknown) => {
        console.error("Failed to disconnect terminal transport.", cause);
      });
    };
  }, [bridge, handleProtocolFailure, handleStateChange]);

  return {
    controller: activeController?.bridge === bridge ? activeController.controller : null,
    transportError,
  };
};
