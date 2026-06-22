import { HostValidationError } from "../../effect/host-errors";

const WINDOWS_SHELL_NEWLINE_PATTERN = /[\r\n]/u;
const WINDOWS_BATCH_QUOTE_PATTERN = /["]/u;
const WINDOWS_BATCH_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/iu;

export const assertNoWindowsShellNewlines = (
  value: string,
  field: "argument" | "command",
): void => {
  if (WINDOWS_SHELL_NEWLINE_PATTERN.test(value)) {
    throw new HostValidationError({
      field,
      message: `Windows shell ${field} cannot contain carriage returns or newlines.`,
    });
  }
};

export const assertSafeWindowsBatchValue = (value: string, field: "argument" | "command"): void => {
  assertNoWindowsShellNewlines(value, field);
  if (WINDOWS_BATCH_QUOTE_PATTERN.test(value)) {
    throw new HostValidationError({
      field,
      message: `Windows batch ${field} cannot contain double quotes.`,
    });
  }
};

const windowsBatchEnvReference = (name: string): string => {
  if (!WINDOWS_BATCH_ENV_NAME_PATTERN.test(name)) {
    throw new HostValidationError({
      field: "argument",
      message: `Windows shell environment variable name '${name}' is invalid.`,
    });
  }
  return `"%${name}%"`;
};

export const escapeWindowsQuotedArgumentValue = (value: string): string => {
  let escaped = "";
  let backslashCount = 0;

  // The value is expanded inside an existing "%VAR%" pair. Use the Windows argv
  // escaping rule for embedded quotes and for backslashes before the closing quote.
  for (const character of value) {
    if (character === "\\") {
      backslashCount += 1;
      continue;
    }

    if (character === `"`) {
      escaped += "\\".repeat(backslashCount * 2 + 1);
      escaped += character;
      backslashCount = 0;
      continue;
    }

    escaped += "\\".repeat(backslashCount);
    escaped += character;
    backslashCount = 0;
  }

  escaped += "\\".repeat(backslashCount * 2);
  return escaped;
};

export const buildWindowsBatchEnvCommandLine = (
  commandEnvName: string,
  argEnvNames: readonly string[],
): string => {
  const invocation = [
    windowsBatchEnvReference(commandEnvName),
    ...argEnvNames.map(windowsBatchEnvReference),
  ].join(" ");
  return `"${invocation}"`;
};
