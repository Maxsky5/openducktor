/** Read shell execution markers through the existing xterm parser, not terminal titles. */
export const createTerminalCommandTracker = (
  nonce: string,
  onCommand: (command: string | null) => void,
): ((data: string) => boolean) => {
  let pending: string | null = null;
  return (data) => {
    const [kind, line, source] = data.split(";");
    if (kind === "E") {
      pending = source === nonce && line ? decodeCommand(line).slice(0, 1024).trim() || null : null;
    } else if (kind === "C" && pending !== null) {
      onCommand(pending);
      pending = null;
    } else if (kind === "D") {
      pending = null;
      onCommand(null);
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
