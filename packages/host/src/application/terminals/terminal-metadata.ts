import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalActivity,
  type TerminalActivityMessage,
  type TerminalListFilter,
  type TerminalSummary,
} from "@openducktor/contracts";
import {
  canRestartCommand,
  copyTerminalSummary,
  isLiveTerminal,
  type TerminalSession,
} from "./terminal-session";
import { terminalContextMatchesFilter } from "./terminal-context";

type ListObserver = {
  snapshot(list: { revision: number; terminals: TerminalSummary[] }): void;
  updated(summary: TerminalSummary, revision: number): void;
  removed(terminalId: string, revision: number): void;
};

/** Metadata observers never attach to terminal output or inspect the process tree. */
export const createTerminalMetadata = (sessions: ReadonlyMap<string, TerminalSession>) => {
  const listeners = new Set<(message: TerminalActivityMessage) => void>();
  const lists = new Set<{ filter: TerminalListFilter; observer: ListObserver }>();
  let revision = 0;
  const snapshot = (filter: TerminalListFilter) => ({
    revision,
    terminals: [...sessions.values()].flatMap((session) =>
      terminalContextMatchesFilter(session.summary.context, filter)
        ? [copyTerminalSummary(session)]
        : [],
    ),
  });
  const read = (session: TerminalSession): TerminalActivity | null => {
    if (!isLiveTerminal(session) || session.command === null) return null;
    return {
      summary: copyTerminalSummary(session),
      command: session.command,
      restartable: canRestartCommand(session),
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
  const removeActivity = (terminalId: string): void =>
    publish({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_removed", terminalId });
  const publishList = (summary: TerminalSummary, removed = false): void => {
    revision += 1;
    for (const entry of lists) {
      if (!terminalContextMatchesFilter(summary.context, entry.filter)) continue;
      try {
        if (removed) entry.observer.removed(summary.terminalId, revision);
        else entry.observer.updated(summary, revision);
      } catch {
        lists.delete(entry);
      }
    }
  };
  return {
    snapshot,
    observeActivity(listener: (message: TerminalActivityMessage) => void): () => void {
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
    observeList(filter: TerminalListFilter, observer: ListObserver): () => void {
      observer.snapshot(snapshot(filter));
      const entry = { filter, observer };
      lists.add(entry);
      return () => lists.delete(entry);
    },
    changed(session: TerminalSession): void {
      if (sessions.get(session.summary.terminalId) !== session) return;
      publishList(copyTerminalSummary(session));
      const activity = read(session);
      if (activity)
        publish({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_updated", activity });
      else removeActivity(session.summary.terminalId);
    },
    remove(summary: TerminalSummary): void {
      removeActivity(summary.terminalId);
      publishList(summary, true);
    },
  };
};
