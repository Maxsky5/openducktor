import type { TerminalCommandResult } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";

/** The outcome text of a startup action command. */
export function actionResultText(result: TerminalCommandResult): string {
  if (terminalCommandSucceeded(result)) return "Command completed successfully.";
  if (result.type === "failed") return result.message;
  if (result.type === "closed")
    return "The terminal closed before the command result was confirmed.";
  if (result.signal !== null) return `Command ended with signal ${result.signal}.`;
  return `Command exited with code ${result.exitCode ?? "unknown"}.`;
}
