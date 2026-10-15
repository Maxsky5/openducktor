/** Bracketed paste keeps multiline input together; the final Enter runs it. */
export const commandInput = (command: string): Uint8Array =>
  new TextEncoder().encode(`\u001b[200~${command}\u001b[201~\r`);
