export const COMMAND_READY_ERROR =
  "The shell did not become ready within 10 seconds. Stop the command or finish the prompt in the terminal, then run it again.";

export const COMMAND_BUFFER_ERROR =
  "The line editor already contains text. Clear it, then run the Action or command again.";

export const commandInput = (command: string): Uint8Array =>
  new TextEncoder().encode(`\u001b[200~${command}\u001b[201~\r`);
