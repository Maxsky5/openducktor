import type { TerminalCommandResult } from "@openducktor/contracts";

export const terminalCommandSucceeded = (result: TerminalCommandResult): boolean =>
  result.type === "exited" && result.exitCode === 0 && result.signal === null;
