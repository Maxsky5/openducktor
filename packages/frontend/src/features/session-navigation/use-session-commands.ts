import { sessionEntryTerminalContext } from "@openducktor/frontend-core/sessions/navigation/session-entry-presentation";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { useTerminalActivity } from "@/state/providers/terminal-activity-provider";

export function useSessionCommands(entry: SessionNavigationEntry) {
  return useTerminalActivity(sessionEntryTerminalContext(entry));
}
