import type { TerminalCommandResult } from "@openducktor/contracts";

export const terminalCommandResultLabel = (result: TerminalCommandResult): string => {
  if (result.type === "failed") return result.message;
  if (result.type === "closed") return "The terminal closed before the command result arrived.";
  const signal = result.signal ? ` Signal: ${result.signal}.` : "";
  return `Exited with code ${result.exitCode ?? "unknown"}.${signal}`;
};
