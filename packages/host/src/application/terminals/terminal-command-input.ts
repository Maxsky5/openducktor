import { formatTerminalPathInput } from "./terminal-path-input";

export const COMMAND_BUFFER_ERROR =
  "The line editor already contains text. Clear it, then run the Action or command again.";

/** Bracketed paste keeps multiline input together; the final Enter runs it. */
export const commandInput = (command: string): Uint8Array =>
  new TextEncoder().encode(`\u001b[200~${command}\u001b[201~\r`);

export const actionReplay = (shell: string, input: string, cwd: string): string =>
  `builtin cd -- ${formatTerminalPathInput(shell, [cwd])} && {\n${input}\n}`;
