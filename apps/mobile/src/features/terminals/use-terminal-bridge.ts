import type { RemoteHostConnection } from "@openducktor/frontend-core/recovery/remote-host-connection";
import { createRemoteTerminalBridge } from "@openducktor/frontend-core/terminals/remote-terminal-bridge";
import type { TerminalBridge } from "@openducktor/frontend-core/terminals/terminal-bridge";
import { useActiveSession } from "@/host-session/active-session-context";

// One bridge for each remote connection, so all terminal views share one transport controller
// and one terminal socket. The transport pool keys its controller on the bridge.
const bridges = new WeakMap<RemoteHostConnection, TerminalBridge>();

const terminalBridgeFor = (remote: RemoteHostConnection): TerminalBridge => {
  const existing = bridges.get(remote);
  if (existing) return existing;
  const bridge = createRemoteTerminalBridge(remote);
  bridges.set(remote, bridge);
  return bridge;
};

/** The terminal transport of the active host connection. */
export const useTerminalBridge = (): TerminalBridge => terminalBridgeFor(useActiveSession().remote);
