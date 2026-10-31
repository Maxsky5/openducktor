import type { TerminalCommandResult } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";

export function terminalCommandResultNotice(result: TerminalCommandResult) {
  if (terminalCommandSucceeded(result))
    return { text: "Command completed successfully.", isFailure: false };
  if (result.type === "failed") return { text: result.message, isFailure: true };
  if (result.type === "closed")
    return {
      text: "The terminal closed before the command result was confirmed.",
      isFailure: true,
    };
  if (result.signal !== null)
    return { text: `Command ended with signal ${result.signal}.`, isFailure: true };
  return { text: `Command exited with code ${result.exitCode ?? "unknown"}.`, isFailure: true };
}
