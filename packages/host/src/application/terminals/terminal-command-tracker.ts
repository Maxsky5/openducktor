import { TERMINAL_LIMITS } from "./terminal-limits";
import { commandInput } from "./terminal-command-input";

export type TerminalTrackedCommand = {
  input: string | null;
  exitCode: number | null;
  ready?: boolean;
};

export const createTerminalCommandTracker = (
  nonce: string,
  onCommand: (command: string | null, details: TerminalTrackedCommand) => void,
): ((data: string) => boolean) => {
  let pending: { command: string; input: string | null } | null = null;
  return (data) => {
    const [kind, line, source, restart] = data.split(";");
    if (kind === "R" && line === nonce && (source === "0" || source === "1")) {
      onCommand(null, { input: null, exitCode: null, ready: source === "1" });
    } else if (kind === "E") {
      const input = source === nonce && line ? decodeCommand(line) : null;
      const command =
        input === null ? null : input.slice(0, TERMINAL_LIMITS.activityCommandLength).trim();
      pending = null;
      if (command) {
        pending = {
          command,
          input:
            restart === "1" &&
            input !== null &&
            commandInput(input).byteLength <= TERMINAL_LIMITS.inputBytes
              ? input
              : null,
        };
      }
    } else if (kind === "C" && pending !== null) {
      onCommand(pending.command, {
        input: pending.input,
        exitCode: null,
      });
      pending = null;
    } else if (kind === "D" && source === nonce && /^\d{1,3}$/u.test(line ?? "")) {
      const exitCode = Number(line);
      if (exitCode > 255) return true;
      pending = null;
      onCommand(null, { input: null, exitCode });
    }
    return true;
  };
};

function decodeCommand(line: string): string {
  return line.replace(/\\\\|(?:\\x[\da-f]{2})+/giu, (escape) => {
    if (escape === "\\\\") return "\\";
    const bytes = escape
      .slice(2)
      .split("\\x")
      .map((hex) => Number.parseInt(hex, 16));
    return new TextDecoder().decode(new Uint8Array(bytes));
  });
}
