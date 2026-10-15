import { TERMINAL_LIMITS } from "./terminal-limits";

/** The C locale counts bytes, so the shell prefix can cut a UTF-8 character. */
export const shellCommandPrefix = (command: string): string =>
  commandPrefix(
    new TextDecoder().decode(
      new TextEncoder().encode(command).subarray(0, TERMINAL_LIMITS.commandMarkerBytes),
    ),
  );

export const commandPrefix = (command: string): string =>
  command.slice(0, TERMINAL_LIMITS.activityCommandLength).trim();
