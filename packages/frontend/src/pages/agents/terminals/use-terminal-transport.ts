import type { TerminalFailure } from "@openducktor/contracts";
import { useCallback, useEffect, useState } from "react";
import type { TerminalBridge } from "@/lib/shell-bridge";
import {
  createTerminalTransportController,
  type TerminalTransportController,
} from "./terminal-transport-controller";

type ScopedController = {
  scopeKey: string;
  controller: TerminalTransportController;
};

export const useTerminalTransport = (
  scopeKey: string | null,
  bridge: TerminalBridge,
): { controller: TerminalTransportController | null; transportError: string | null } => {
  const [scopedController, setScopedController] = useState<ScopedController | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const handleStateChange = useCallback((state: "connected" | "disconnected"): void => {
    if (state === "connected") setTransportError(null);
  }, []);
  const handleProtocolFailure = useCallback((failure: TerminalFailure): void => {
    setTransportError(failure.message);
  }, []);

  useEffect(() => {
    setTransportError(null);
    if (!scopeKey) return;
    const controller = createTerminalTransportController(
      bridge,
      handleStateChange,
      handleProtocolFailure,
    );
    setScopedController({ scopeKey, controller });
    void controller.connect().catch(() => undefined);
    return () => controller.dispose();
  }, [bridge, handleProtocolFailure, handleStateChange, scopeKey]);

  return {
    controller: scopedController?.scopeKey === scopeKey ? scopedController.controller : null,
    transportError,
  };
};
