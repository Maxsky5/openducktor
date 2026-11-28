import { Effect } from "effect";
import { addBackgroundStepDetail } from "../operation-progress/background-operation-progress";
import type { TerminalServiceError } from "./terminal-service-error";

export const reportPartialTerminalCleanup = (cause: TerminalServiceError) => {
  const count = cause.closedTerminalIds?.length ?? 0;
  return count > 0
    ? addBackgroundStepDetail("terminals", `Closed ${count} terminal${count === 1 ? "" : "s"}.`)
    : Effect.void;
};
