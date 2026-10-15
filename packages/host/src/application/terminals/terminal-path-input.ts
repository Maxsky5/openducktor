const POSIX_SHELLS = new Set(["bash", "dash", "ksh", "sh", "zsh"]);
const POWERSHELL_SHELLS = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe"]);

export class TerminalPathInputError extends Error {
  constructor(
    readonly code: "invalid_input" | "unsupported_shell",
    message: string,
  ) {
    super(message);
    this.name = "TerminalPathInputError";
  }
}

const shellExecutableName = (shell: string): string => {
  const segments = shell.toLowerCase().split(/[\\/]/);
  return segments.at(-1) ?? "";
};

const assertSafePath = (path: string): void => {
  if (/[\0\r\n]/.test(path)) {
    throw new TerminalPathInputError(
      "invalid_input",
      "Terminal paths cannot contain NUL or newline characters.",
    );
  }
};

const quotePosixPath = (path: string): string => `'${path.replaceAll("'", "'\\''")}'`;
const quoteFishPath = (path: string): string =>
  `'${path.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const quotePowerShellPath = (path: string): string => `'${path.replaceAll("'", "''")}'`;
const quoteCmdPath = (path: string): string => `"${path.replaceAll('"', '""')}"`;

export const formatTerminalPathInput = (shell: string, paths: readonly string[]): string => {
  const executable = shellExecutableName(shell);
  let quote: (path: string) => string;
  if (POSIX_SHELLS.has(executable)) quote = quotePosixPath;
  else if (executable === "fish") quote = quoteFishPath;
  else if (POWERSHELL_SHELLS.has(executable)) quote = quotePowerShellPath;
  else if (executable === "cmd" || executable === "cmd.exe") quote = quoteCmdPath;
  else {
    throw new TerminalPathInputError(
      "unsupported_shell",
      `Unsupported terminal shell for path input: ${shell}`,
    );
  }

  return paths
    .map((path) => {
      assertSafePath(path);
      return quote(path);
    })
    .join(" ");
};
