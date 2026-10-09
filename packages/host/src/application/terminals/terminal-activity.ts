import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalActivity,
  type TerminalActivityMessage,
} from "@openducktor/contracts";
import { copyTerminalSummary, isLiveTerminal, type TerminalSession } from "./terminal-session";

/** Metadata observers never attach to terminal output or inspect the process tree. */
export const createTerminalActivity = (sessions: ReadonlyMap<string, TerminalSession>) => {
  const listeners = new Set<(message: TerminalActivityMessage) => void>();
  const read = (session: TerminalSession): TerminalActivity | null => {
    if (!isLiveTerminal(session) || session.command === null) return null;
    return {
      summary: copyTerminalSummary(session),
      command: session.command,
    };
  };
  const publish = (message: TerminalActivityMessage): void => {
    for (const listener of listeners) {
      try {
        listener(message);
      } catch {
        // A disconnected observer must not block process cleanup.
        listeners.delete(listener);
      }
    }
  };
  const remove = (terminalId: string): void =>
    publish({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_removed", terminalId });
  return {
    observe(listener: (message: TerminalActivityMessage) => void): () => void {
      // One record per frame keeps the snapshot within the protocol's header limit.
      listener({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_start" });
      for (const session of sessions.values()) {
        const activity = read(session);
        if (activity)
          listener({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_updated", activity });
      }
      listener({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_end" });
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    changed(session: TerminalSession): void {
      if (sessions.get(session.summary.terminalId) !== session) return;
      const activity = read(session);
      if (activity)
        publish({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_updated", activity });
      else remove(session.summary.terminalId);
    },
    remove,
  };
};
