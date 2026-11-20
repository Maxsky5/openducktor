import type { TerminalBridge } from "@openducktor/frontend-core/terminals/terminal-bridge";
import { useActiveSession } from "@/host-session/active-session-context";

/**
 * The terminal transport of the active session. Each session has one bridge, so all terminal
 * views share one transport controller and one terminal socket.
 */
export const useTerminalBridge = (): TerminalBridge => useActiveSession().terminalBridge;
