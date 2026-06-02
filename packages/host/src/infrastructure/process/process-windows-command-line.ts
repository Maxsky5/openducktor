import { HostValidationError } from "../../effect/host-errors";

const WINDOWS_BATCH_ESCAPE_PATTERN = /[\^"]/gu;
const WINDOWS_BATCH_NEWLINE_PATTERN = /[\r\n]/u;

const assertNoWindowsBatchNewlines = (value: string, field: "argument" | "command"): void => {
  if (WINDOWS_BATCH_NEWLINE_PATTERN.test(value)) {
    throw new HostValidationError({
      field,
      message: `Windows batch ${field} cannot contain carriage returns or newlines.`,
    });
  }
};

const escapeWindowsBatchCharacter = (character: string): string => {
  switch (character) {
    case "^":
      return "^^";
    case `"`:
      return `^"`;
    default:
      return character;
  }
};

/** @internal Test-only seam for Windows batch quoting. */
export const quoteWindowsBatchArgument = (value: string): string => {
  assertNoWindowsBatchNewlines(value, "argument");
  return `"${value.replace(WINDOWS_BATCH_ESCAPE_PATTERN, escapeWindowsBatchCharacter)}"`;
};

export const buildWindowsBatchCommandLine = (command: string, args: readonly string[]): string => {
  assertNoWindowsBatchNewlines(command, "command");
  const invocation = [
    quoteWindowsBatchArgument(command),
    ...args.map(quoteWindowsBatchArgument),
  ].join(" ");
  return `"${invocation}"`;
};
