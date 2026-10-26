import type {
  TerminalActivity,
  TerminalRestartRequest,
  TerminalRestartResponse,
} from "@openducktor/contracts";
import type { TerminalActivityState } from "./terminal-activity-store";

/** The command that the activity stream reports for `terminalId`, once the stream is ready. */
export const findTerminalActivity = (
  state: TerminalActivityState,
  terminalId: string,
): TerminalActivity | undefined =>
  state.status === "ready"
    ? state.commands.find((item) => item.summary.terminalId === terminalId)
    : undefined;

/**
 * Restarts the command that the activity stream reports, so a command that changed in the
 * meantime does not restart. A failure rejects while the command stays the same. A failure after
 * the command changed belongs to the old command, so the restart then resolves.
 */
export const restartTerminalCommand = async (
  activity: TerminalActivity,
  readActivity: () => TerminalActivityState,
  restart: (request: TerminalRestartRequest) => Promise<TerminalRestartResponse>,
): Promise<void> => {
  const terminalId = activity.summary.terminalId;
  try {
    await restart({ terminalId, expectedCommand: activity.command });
  } catch (cause) {
    const latest = findTerminalActivity(readActivity(), terminalId);
    if (latest !== undefined && latest.command !== activity.command) return;
    throw cause;
  }
};
