const WINDOWS_BATCH_ESCAPE_PATTERN = /[\^%!"]/gu;

const escapeWindowsBatchCharacter = (character: string): string => {
  switch (character) {
    case "^":
      return "^^";
    case "%":
      return "%%";
    case "!":
      return "^!";
    case `"`:
      return `^"`;
    default:
      return character;
  }
};

export const quoteWindowsBatchArgument = (value: string): string =>
  `"${value.replace(WINDOWS_BATCH_ESCAPE_PATTERN, escapeWindowsBatchCharacter)}"`;

export const buildWindowsBatchCommandLine = (command: string, args: readonly string[]): string => {
  const invocation = [
    quoteWindowsBatchArgument(command),
    ...args.map(quoteWindowsBatchArgument),
  ].join(" ");
  return `"${invocation}"`;
};
