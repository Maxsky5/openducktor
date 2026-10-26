import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";

/** What the file viewer shows for a host file read. */
export type FileContentView =
  | { kind: "text"; contents: string }
  | { kind: "image"; uri: string; mime: string }
  | { kind: "message"; title: string; message: string };

/**
 * The viewer content of a file read. Text shows with line numbers. An image shows as an image. A
 * binary file or a file over the host read limit shows the reason instead of content.
 */
export const fileContentView = (result: WorkspaceTextFileReadResult): FileContentView => {
  switch (result.kind) {
    case "text":
      return result.contents.length === 0
        ? { kind: "message", title: "Empty File", message: "The file has no content." }
        : { kind: "text", contents: result.contents };
    case "image":
      return {
        kind: "image",
        uri: `data:${result.mime};base64,${result.base64}`,
        mime: result.mime,
      };
    case "unsupported":
      return result.reason === "binary"
        ? { kind: "message", title: "Binary File", message: result.message }
        : { kind: "message", title: "File Too Large", message: result.message };
  }
};

/**
 * The most lines that the code view highlights, as desktop `PIERRE_HIGHLIGHT_LINE_LIMIT`. A larger
 * file shows plain text, so it opens and scrolls without highlight work.
 */
export const HIGHLIGHT_LINE_LIMIT = 1000;

/** The line count of a text as the code view splits it. A final line break starts no line. */
export const textLineCount = (contents: string): number => {
  const text = contents.replace(/\r\n?/g, "\n");
  let count = 1;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) {
    count += 1;
  }
  return count > 1 && text.endsWith("\n") ? count - 1 : count;
};

/**
 * The width of the line number column in monospaced characters, as the desktop code view: the
 * digits of the last line number and 1.25 characters of padding.
 */
export const lineNumberColumnChars = (lineCount: number): number =>
  String(Math.max(1, lineCount)).length + 1.25;
