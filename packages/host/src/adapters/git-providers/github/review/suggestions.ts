type GithubReviewCommentContentInput = {
  body: string;
  diffHunk: string | null;
  lineRanges: GithubReviewCommentLineRange[];
};

export type GithubReviewCommentLineRange = {
  startLine: number;
  endLine: number;
};

type GithubReviewCommentContent = {
  body: string;
  suggestionPatches: string[];
  suggestionWarning: string | null;
};

const GITHUB_SUGGESTION_BLOCK = /^```suggestion[^\r\n]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gmu;
const DIFF_HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

const selectedRightSideLines = (
  diffHunk: string,
  startLine: number,
  endLine: number,
): string[] | null => {
  const selectedLines: string[] = [];
  let rightLineNumber: number | null = null;

  for (const line of diffHunk.split(/\r?\n/u)) {
    const hunkHeader = DIFF_HUNK_HEADER.exec(line);
    if (hunkHeader) {
      rightLineNumber = Number.parseInt(hunkHeader[1] ?? "", 10);
      continue;
    }
    if (rightLineNumber === null || line.startsWith("\\")) {
      continue;
    }
    const prefix = line.at(0);
    if (prefix === "-") {
      continue;
    }
    if (prefix !== "+" && prefix !== " ") {
      continue;
    }
    if (rightLineNumber >= startLine && rightLineNumber <= endLine) {
      selectedLines.push(line.slice(1));
    }
    rightLineNumber += 1;
  }

  const expectedLineCount = endLine - startLine + 1;
  if (selectedLines.length !== expectedLineCount) {
    return null;
  }
  return selectedLines;
};

const replacementLines = (replacement: string): string[] => {
  const normalized = replacement.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return normalized.length === 0 ? [] : normalized.split("\n");
};

const buildSuggestionPatch = (
  diffHunk: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string | null => {
  const currentLines = selectedRightSideLines(diffHunk, startLine, endLine);
  if (!currentLines) {
    return null;
  }
  const nextLines = replacementLines(replacement);
  return [
    `@@ -${startLine},${currentLines.length} +${startLine},${nextLines.length} @@`,
    ...currentLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`),
  ].join("\n");
};

export const parseGithubReviewCommentContent = ({
  body,
  diffHunk,
  lineRanges,
}: GithubReviewCommentContentInput): GithubReviewCommentContent => {
  const replacements: string[] = [];
  const markdownBody = body
    .replace(GITHUB_SUGGESTION_BLOCK, (_block, replacement: string) => {
      replacements.push(replacement.replace(/\r?\n$/u, ""));
      return "";
    })
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  if (replacements.length === 0) {
    return { body: markdownBody, suggestionPatches: [], suggestionWarning: null };
  }
  if (!diffHunk || lineRanges.length === 0) {
    return { body: body.trim(), suggestionPatches: [], suggestionWarning: null };
  }

  for (const lineRange of lineRanges) {
    const suggestionPatches: string[] = [];
    for (const replacement of replacements) {
      const suggestionPatch = buildSuggestionPatch(
        diffHunk,
        lineRange.startLine,
        lineRange.endLine,
        replacement,
      );
      if (!suggestionPatch) {
        break;
      }
      suggestionPatches.push(suggestionPatch);
    }
    if (suggestionPatches.length === replacements.length) {
      return {
        body: markdownBody,
        suggestionPatches,
        suggestionWarning: null,
      };
    }
  }

  return {
    body: body.trim(),
    suggestionPatches: [],
    suggestionWarning: "GitHub suggestion lines could not be located in the review diff hunk.",
  };
};
