import type { HostInvokeFailure } from "@openducktor/contracts";
import {
  TerminalServiceError,
  terminalServiceErrorToFailure,
} from "../../application/terminals/terminal-service";
import { CodexSessionHistoryError } from "../../ports/codex-session-history-error";

export const hostInvokeFailureFromError = (cause: unknown): HostInvokeFailure | undefined => {
  if (cause instanceof TerminalServiceError) {
    return {
      kind: "terminal",
      terminalFailure: terminalServiceErrorToFailure(cause),
    };
  }
  if (cause instanceof CodexSessionHistoryError) {
    return {
      kind: "session_history",
      sessionHistoryFailure: cause.failure,
    };
  }
  return undefined;
};
