export type TaskDescriptionFrontMatter =
  | { kind: "none"; raw: ""; body: string }
  | { kind: "valid"; raw: string; body: string }
  | { kind: "malformed"; syntax: "YAML" | "TOML"; closingDelimiter: "---" | "+++" };

const findLineEnd = (markdown: string, offset: number): number => {
  const lineFeed = markdown.indexOf("\n", offset);
  return lineFeed === -1 ? markdown.length : lineFeed + 1;
};

export const splitTaskDescriptionFrontMatter = (markdown: string): TaskDescriptionFrontMatter => {
  let delimiter: "---" | "+++";
  let syntax: "YAML" | "TOML";

  if (markdown.startsWith("---\n") || markdown.startsWith("---\r\n")) {
    delimiter = "---";
    syntax = "YAML";
  } else if (markdown.startsWith("+++\n") || markdown.startsWith("+++\r\n")) {
    delimiter = "+++";
    syntax = "TOML";
  } else {
    return { kind: "none", raw: "", body: markdown };
  }

  let lineStart = findLineEnd(markdown, 0);
  while (lineStart < markdown.length) {
    const lineEnd = findLineEnd(markdown, lineStart);
    const line = markdown.slice(lineStart, lineEnd).replace(/\r?\n$/, "");
    if (line === delimiter) {
      return {
        kind: "valid",
        raw: markdown.slice(0, lineEnd),
        body: markdown.slice(lineEnd),
      };
    }
    lineStart = lineEnd;
  }

  return { kind: "malformed", syntax, closingDelimiter: delimiter };
};
