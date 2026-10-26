import type { TerminalCloseResponse } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  type TerminalTab,
  terminalTabLabel,
} from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { terminalCloseNeedsConfirmation } from "@openducktor/frontend-core/terminals/terminal-tab-presentation";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import { isOutcomeUnknown } from "@openducktor/frontend-core/lib/command-outcome";

export type TerminalCloseOutcome =
  | { kind: "closed" }
  | { kind: "kept" }
  | { kind: "unknown"; guidance: string }
  | { kind: "failed"; message: string };

export type TerminalCloseModel = Pick<
  TerminalSessionsModel,
  "onClose" | "runningCommandTerminalIds"
>;

/**
 * Closes a terminal as desktop does. A terminal with a running command asks first. Otherwise the
 * host closes it at once, or reports running child processes, and then the app asks. A lost
 * close result is never sent again: it shows the host guidance until the terminal list shows the
 * real state.
 */
export const closeTerminalTab = async (
  model: TerminalCloseModel,
  tab: TerminalTab,
  confirmTerminate: (label: string) => Promise<boolean>,
): Promise<TerminalCloseOutcome> => {
  const label = terminalTabLabel(tab);
  const runsCommand = terminalCloseNeedsConfirmation(tab, model.runningCommandTerminalIds);
  if (runsCommand && !(await confirmTerminate(label))) return { kind: "kept" };
  try {
    let result: TerminalCloseResponse = await model.onClose(tab, runsCommand);
    if (!result.closed) {
      if (!(await confirmTerminate(label))) return { kind: "kept" };
      result = await model.onClose(tab, true);
    }
    return result.closed ? { kind: "closed" } : { kind: "kept" };
  } catch (cause) {
    if (isOutcomeUnknown(cause)) {
      return { kind: "unknown", guidance: cause.failure.nextAction };
    }
    return { kind: "failed", message: errorMessage(cause) };
  }
};
