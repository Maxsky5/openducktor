import { sessionEntryTerminalContext } from "@openducktor/frontend-core/sessions/navigation/session-entry-presentation";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import {
  EMPTY_TERMINAL_ACTIVITY,
  terminalActivityOwnerKey,
} from "@openducktor/frontend-core/terminals/terminal-activity-store";
import type { TerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import { createContext, use, useCallback, useSyncExternalStore } from "react";

/**
 * The terminal transport of the session list. Each row reads the commands that run for its task
 * or chat from it, as the desktop sidebar does.
 */
export const SessionCommandsContext = createContext<TerminalTransportController | null>(null);

const noSubscription = (): (() => void) => () => {};
const emptyActivity = () => EMPTY_TERMINAL_ACTIVITY;

/** The number of commands that run in the terminals of the task or chat of an entry. */
export const useSessionCommandCount = (entry: SessionNavigationEntry): number => {
  const controller = use(SessionCommandsContext);
  const key = terminalActivityOwnerKey(sessionEntryTerminalContext(entry));
  const read = useCallback(
    () => (controller ? controller.readActivity(key) : EMPTY_TERMINAL_ACTIVITY),
    [controller, key],
  );
  const state = useSyncExternalStore(
    controller?.subscribeActivity ?? noSubscription,
    read,
    emptyActivity,
  );
  return state.status === "ready" ? state.commands.length : 0;
};
