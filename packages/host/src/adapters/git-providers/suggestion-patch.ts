const splitLines = (text: string): string[] =>
  text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");

/** The lines of a suggestion block. An empty suggestion removes the lines. */
const replacementLines = (replacement: string): string[] =>
  replacement.length === 0 ? [] : splitLines(replacement);

/** The unified hunk that replaces `currentLines`, which start at `startLine`, with a suggestion. */
export const formatSuggestionPatch = (
  startLine: number,
  currentLines: readonly string[],
  replacement: string,
): string => {
  const nextLines = replacementLines(replacement);
  return [
    `@@ -${startLine},${currentLines.length} +${startLine},${nextLines.length} @@`,
    ...currentLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`),
  ].join("\n");
};

/** The hunk that replaces lines `startLine` to `endLine` of a file, or null outside the file. */
export const fileSuggestionPatch = (
  fileContent: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string | null => {
  if (startLine < 1 || endLine < startLine) return null;
  const currentLines = splitLines(fileContent).slice(startLine - 1, endLine);
  return currentLines.length === endLine - startLine + 1
    ? formatSuggestionPatch(startLine, currentLines, replacement)
    : null;
};
