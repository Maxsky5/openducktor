type GithubReviewCommentContentInput = {
  body: string;
  diffHunk: string | null;
  startLine: number | null;
  endLine: number | null;
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
  startLine,
  endLine,
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
  if (!diffHunk || startLine === null || endLine === null) {
    return { body: body.trim(), suggestionPatches: [], suggestionWarning: null };
  }

  const suggestionPatches: string[] = [];
  for (const replacement of replacements) {
    const suggestionPatch = buildSuggestionPatch(diffHunk, startLine, endLine, replacement);
    if (!suggestionPatch) {
      return {
        body: body.trim(),
        suggestionPatches: [],
        suggestionWarning: "GitHub suggestion lines could not be located in the review diff hunk.",
      };
    }
    suggestionPatches.push(suggestionPatch);
  }
  return {
    body: markdownBody,
    suggestionPatches,
    suggestionWarning: null,
  };
};
