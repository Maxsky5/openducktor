import { useEffect, useEffectEvent, useState } from "react";
import type { TerminalBridge } from "@/lib/shell-bridge";
import type { TerminalTransportController } from "./terminal-transport-controller";
import { acquireTerminalTransport } from "./terminal-transport-pool";

type ActiveController = { bridge: TerminalBridge; controller: TerminalTransportController };

export const useTerminalTransport = (
  bridge: TerminalBridge,
  onError?: (error: string | null) => void,
) => {
  const [activeController, setActiveController] = useState<ActiveController | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const handleError = useEffectEvent((error: string | null) => {
    setTransportError(error);
    onError?.(error);
  });
  useEffect(() => {
    const lease = acquireTerminalTransport(bridge, handleError);
    setActiveController({ bridge, controller: lease.controller });
    return () => lease.release();
  }, [bridge]);
  return {
    controller: activeController?.bridge === bridge ? activeController.controller : null,
    transportError,
  };
};
