/** The bytes of the named C escapes that Git writes in a quoted path. */
const GIT_PATH_ESCAPES = new Map([
  ["a", 7],
  ["b", 8],
  ["t", 9],
  ["n", 10],
  ["v", 11],
  ["f", 12],
  ["r", 13],
  ['"', 34],
  ["\\", 92],
]);
const GIT_PATH_ESCAPE = /\\(?:([0-7]{3})|([abtnvfr"\\]))/gu;
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/**
 * Reads the inside of a path that Git quotes in C style. Git writes each byte of a non-ASCII
 * name as an octal escape, so `\303\251.txt` is `é.txt`.
 */
export const unquoteGitPath = (quoted: string): string => {
  const bytes: number[] = [];
  let textStart = 0;
  for (const escape of quoted.matchAll(GIT_PATH_ESCAPE)) {
    bytes.push(...utf8Encoder.encode(quoted.slice(textStart, escape.index)));
    const [sequence, octal, character] = escape;
    bytes.push(octal ? Number.parseInt(octal, 8) : (GIT_PATH_ESCAPES.get(character ?? "") ?? 0));
    textStart = escape.index + sequence.length;
  }
  bytes.push(...utf8Encoder.encode(quoted.slice(textStart)));
  return utf8Decoder.decode(Uint8Array.from(bytes));
};

/** A path to the end of a header line, such as `rename to <path>`. Git quotes it when needed. */
export const headerLinePath = (value: string): string =>
  value.length > 1 && value.startsWith('"') && value.endsWith('"')
    ? unquoteGitPath(value.slice(1, -1))
    : value;
