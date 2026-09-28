export type FileDiffLineCounts = {
  additions: number;
  deletions: number;
};

export type SelectRenderableFileDiffOptions = {
  changeType?: string | null;
  fullFileContent?: boolean;
  windowsPaths?: boolean;
};

const GIT_DIFF_HEADER = /^diff --git /m;
// File text can contain a Git header, so wait for a change line.
const GIT_PATCH_BODY =
  /^(?:index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename (?:from|to) |copy (?:from|to) |Binary files |GIT binary patch$)/m;
const CLASSIC_DIFF_HEADER = /^Index: /m;
const UNIFIED_MULTI_FILE_HEADER = /^--- .+\n\+\+\+ .+/m;
const UNIFIED_HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const APPLY_PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete) File: /m;

export const selectRenderableFileDiff = (
  rawDiff: string,
  filePath: string,
  options: SelectRenderableFileDiffOptions = {},
): string | null => {
  const candidates = splitFileDiffCandidates(rawDiff);
  if (candidates.length === 0) {
    return null;
  }
  const fullFileDiffMode = fullFileDiffModeFromChangeType(options.changeType);
  if (fullFileDiffMode && (options.fullFileContent || !hasPatchMarkers(rawDiff))) {
    return fullFileContentDiff(rawDiff, filePath, fullFileDiffMode);
  }

  let matchingCandidate: string | null = null;
  let strongestMatch: DiffPathMatch | null = null;
  let ambiguousMatch = false;
  const requestedPath = options.windowsPaths ? filePath.replaceAll("\\", "/") : filePath;
  for (const candidate of candidates) {
    const match = fileDiffCandidateMatch(candidate, requestedPath, options.changeType);
    if (!match) {
      continue;
    }
    const comparison = strongestMatch ? compareDiffPathMatches(match, strongestMatch) : 1;
    if (comparison > 0) {
      matchingCandidate = candidate;
      strongestMatch = match;
      ambiguousMatch = false;
    } else if (comparison === 0) {
      ambiguousMatch = true;
    }
  }
  if (ambiguousMatch) {
    return null;
  }
  if (matchingCandidate) {
    return normalizeRenderableFileDiffCandidate(matchingCandidate, filePath);
  }

  const hasFileHeader = candidates.some(hasExplicitFileHeader);
  const fallbackCandidate = candidates.length === 1 ? candidates[0] : null;
  if (fallbackCandidate && !hasFileHeader) {
    const normalizedCandidate = normalizeRenderableFileDiffCandidate(fallbackCandidate, filePath);
    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return null;
};

const normalizeNewlines = (value: string): string => value.replace(/\r\n?/g, "\n");

const trimNewlines = (value: string): string => value.replace(/^\n+|\n+$/g, "");

const toDiffHeaderPath = (filePath: string): string =>
  filePath.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^\.\//, "");

const fullFileDiffModeFromChangeType = (changeType?: string | null): "added" | "deleted" | null => {
  const normalized = changeType?.trim().toLowerCase();
  if (normalized === "added") {
    return "added";
  }
  if (normalized === "deleted") {
    return "deleted";
  }
  return null;
};

const fullFileContentDiff = (
  rawContent: string,
  filePath: string,
  mode: "added" | "deleted",
): string => {
  const diffPath = toDiffHeaderPath(filePath);
  const normalized = normalizeNewlines(rawContent).replace(/\n$/, "");
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  const lineCount = lines.length;
  const prefix = mode === "added" ? "+" : "-";
  const body = lines.map((line) => `${prefix}${line}`);

  if (mode === "added") {
    return ["--- /dev/null", `+++ b/${diffPath}`, `@@ -0,0 +1,${lineCount} @@`, ...body, ""].join(
      "\n",
    );
  }

  return [`--- a/${diffPath}`, "+++ /dev/null", `@@ -1,${lineCount} +0,0 @@`, ...body, ""].join(
    "\n",
  );
};

const splitSections = (value: string, separator: RegExp): string[] => {
  const sections: string[] = [];
  for (const part of value.split(separator)) {
    const section = trimNewlines(part);
    if (section.trim().length > 0) {
      sections.push(section);
    }
  }
  return sections;
};

const applyPatchFileContentDiff = (candidate: string, filePath: string): string | null => {
  const lines = trimNewlines(candidate).split("\n");
  const diffPath = toDiffHeaderPath(filePath);
  const header = lines[0] ?? "";
  const isAdd = header.startsWith("*** Add File: ");
  const isDelete = header.startsWith("*** Delete File: ");
  if (!isAdd && !isDelete) {
    return null;
  }

  const prefix = isAdd ? "+" : "-";
  const body = lines.slice(1).filter((line) => line.startsWith(prefix));
  const bodyLines = body.map((line) => line.slice(1));
  const lineCount = Math.max(bodyLines.length, 1);
  if (isAdd) {
    return ["--- /dev/null", `+++ b/${diffPath}`, `@@ -0,0 +1,${lineCount} @@`, ...body, ""].join(
      "\n",
    );
  }

  return [`--- a/${diffPath}`, "+++ /dev/null", `@@ -1,${lineCount} +0,0 @@`, ...body, ""].join(
    "\n",
  );
};

export const normalizeRenderableFileDiffCandidate = (
  candidate: string,
  filePath: string,
): string | null => {
  const patch = trimNewlines(normalizeNewlines(candidate));
  if (patch.trim().length === 0) {
    return null;
  }

  const applyPatchDiff = applyPatchFileContentDiff(patch, filePath);
  if (applyPatchDiff) {
    return applyPatchDiff;
  }

  const lines = patch.split("\n");
  const markerIndex = lines.findIndex(
    (line) => line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("@@"),
  );
  if (markerIndex < 0) {
    return null;
  }

  const rawRelevantLines = lines.slice(markerIndex);
  const endPatchIndex = rawRelevantLines.findIndex(
    (line, index) => index > 0 && line.startsWith("*** End Patch"),
  );
  const relevantLines =
    endPatchIndex >= 0 ? rawRelevantLines.slice(0, endPatchIndex) : rawRelevantLines;
  const normalized = trimNewlines(relevantLines.join("\n"));
  if (normalized.trim().length === 0) {
    return null;
  }

  if (normalized.startsWith("@@")) {
    const diffPath = toDiffHeaderPath(filePath);
    return `--- a/${diffPath}\n+++ b/${diffPath}\n${normalized}\n`;
  }

  return `${normalized}\n`;
};

const splitUnifiedFileDiffCandidates = (diff: string): string[] => {
  const lines = diff.split("\n");
  const candidates: string[] = [];
  let candidateStart = 0;
  let oldLinesLeft = 0;
  let newLinesLeft = 0;
  let bareHunk = false;

  const addCandidate = (end: number): void => {
    const candidate = trimNewlines(lines.slice(candidateStart, end).join("\n"));
    if (candidate.trim().length > 0) {
      candidates.push(candidate);
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (bareHunk) {
      continue;
    }
    if (oldLinesLeft > 0 || newLinesLeft > 0) {
      if (line === "" || line.startsWith(" ")) {
        oldLinesLeft--;
        newLinesLeft--;
      } else if (line.startsWith("-")) {
        oldLinesLeft--;
      } else if (line.startsWith("+")) {
        newLinesLeft--;
      }
      continue;
    }

    if (line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      if (index > candidateStart) {
        addCandidate(index);
        candidateStart = index;
      }
      index++;
      continue;
    }

    const hunk = UNIFIED_HUNK_HEADER.exec(line);
    if (hunk) {
      oldLinesLeft = Number(hunk[1] ?? 1);
      newLinesLeft = Number(hunk[2] ?? 1);
    } else if (line.startsWith("@@")) {
      // A bare hunk has no counts to tell its edits from the next file header.
      bareHunk = true;
    }
  }

  addCandidate(lines.length);
  return candidates;
};

const hasPatchMarkers = (rawDiff: string): boolean => {
  const diff = normalizeNewlines(rawDiff);
  return (
    (GIT_DIFF_HEADER.test(diff) && GIT_PATCH_BODY.test(diff)) ||
    APPLY_PATCH_FILE_HEADER.test(diff) ||
    diff.split("\n").some((line) => UNIFIED_HUNK_HEADER.test(line)) ||
    (UNIFIED_MULTI_FILE_HEADER.test(diff) && /^@@$/m.test(diff)) ||
    (CLASSIC_DIFF_HEADER.test(diff) && /^={3,}$/m.test(diff))
  );
};

export const splitFileDiffCandidates = (rawDiff: string): string[] => {
  const diff = trimNewlines(normalizeNewlines(rawDiff));
  if (diff.trim().length === 0) {
    return [];
  }

  if (GIT_DIFF_HEADER.test(diff)) {
    return splitSections(diff, /(?=^diff --git )/m);
  }

  if (CLASSIC_DIFF_HEADER.test(diff)) {
    return splitSections(diff, /(?=^Index: )/m);
  }

  if (APPLY_PATCH_FILE_HEADER.test(diff)) {
    const patchBody = diff
      .replace(/^\*\*\* Begin Patch\s*\n?/m, "")
      .replace(/\n?\*\*\* End Patch\s*$/m, "");
    return splitSections(patchBody, /(?=^\*\*\* (?:Add|Update|Delete) File: )/m);
  }

  if (UNIFIED_MULTI_FILE_HEADER.test(diff)) {
    return splitUnifiedFileDiffCandidates(diff);
  }

  return [diff];
};

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

const normalizeDiffFilePath = (filePath: string): string => {
  // A Git-quoted backslash can be part of a POSIX file name.
  const path = WINDOWS_ABSOLUTE_PATH.test(filePath) ? filePath.replaceAll("\\", "/") : filePath;
  return path.replace(/^\.\//, "");
};

const GIT_QUOTED_PATH = /^"(?:\\.|[^"\\])*"$/;
const GIT_ESCAPE_BYTES = new Map([
  ["a", 7],
  ["b", 8],
  ["f", 12],
  ["n", 10],
  ["r", 13],
  ["t", 9],
  ["v", 11],
  ['"', 34],
  ["\\", 92],
]);

const decodeGitQuotedPath = (filePath: string): string | null => {
  if (!filePath.startsWith('"') || !filePath.endsWith('"')) {
    return filePath;
  }
  if (!GIT_QUOTED_PATH.test(filePath)) {
    return null;
  }

  const characters = Array.from(filePath.slice(1, -1));
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (character !== "\\") {
      bytes.push(...encoder.encode(character));
      continue;
    }

    const escaped = characters[++index] ?? "";
    if (/^[0-7]$/.test(escaped)) {
      const octal = characters.slice(index, index + 3).join("");
      if (!/^[0-7]{3}$/.test(octal)) {
        return null;
      }
      const byte = Number.parseInt(octal, 8);
      if (byte === 0 || byte > 255) {
        return null;
      }
      bytes.push(byte);
      index += 2;
      continue;
    }

    const escapedByte = GIT_ESCAPE_BYTES.get(escaped);
    if (escapedByte === undefined) {
      return null;
    }
    bytes.push(escapedByte);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
};

const normalizeHeaderFilePath = (filePath: string, hasDiffPrefix: boolean): string => {
  const decoded = decodeGitQuotedPath(filePath);
  if (decoded === null) {
    return "";
  }
  const normalized = normalizeDiffFilePath(decoded);
  return hasDiffPrefix ? normalized.replace(/^(?:a|b)\//, "") : normalized;
};

const isAbsoluteDiffPath = (filePath: string): boolean =>
  filePath.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(filePath);

type DiffPathMatch = { exact: boolean; matchedLength: number };

const compareDiffPathMatches = (left: DiffPathMatch, right: DiffPathMatch): number =>
  Number(left.exact) - Number(right.exact) || left.matchedLength - right.matchedLength;

const strongerDiffPathMatch = (
  current: DiffPathMatch | null,
  next: DiffPathMatch | null,
): DiffPathMatch | null =>
  next && (!current || compareDiffPathMatches(next, current) > 0) ? next : current;

const diffPathsMatch = (
  headerPath: string,
  filePath: string,
  hasDiffPrefix = true,
): DiffPathMatch | null => {
  const header = normalizeHeaderFilePath(headerPath, hasDiffPrefix);
  const requested = normalizeDiffFilePath(filePath);
  if (header.length === 0 || requested.length === 0 || header === "/dev/null") {
    return null;
  }
  if (header === requested) {
    return { exact: true, matchedLength: header.length };
  }
  if (isAbsoluteDiffPath(requested) && !isAbsoluteDiffPath(header)) {
    return requested.endsWith(`/${header}`) ? { exact: false, matchedLength: header.length } : null;
  }
  if (isAbsoluteDiffPath(header) && !isAbsoluteDiffPath(requested)) {
    return header.endsWith(`/${requested}`)
      ? { exact: false, matchedLength: requested.length }
      : null;
  }
  return null;
};

const diffHeaderPaths = (line: string): string[] => {
  const quotedGitHeader = /^diff --git ("(?:\\.|[^"\\])*") ("(?:\\.|[^"\\])*")$/.exec(line);
  if (quotedGitHeader) {
    return [quotedGitHeader[1] ?? "", quotedGitHeader[2] ?? ""];
  }

  if (line.startsWith("diff --git ")) {
    const paths = line.slice("diff --git ".length);
    const repeatedPath = /^(.+) \1$/.exec(paths);
    if (repeatedPath) {
      return [repeatedPath[1] ?? "", repeatedPath[1] ?? ""];
    }

    if (paths.startsWith("a/")) {
      const samePath = /^a\/(.+) b\/\1$/.exec(paths);
      if (samePath) {
        return [`a/${samePath[1]}`, `b/${samePath[1]}`];
      }

      // With two " b/" breaks, we cannot tell where the first path ends.
      const separator = paths.indexOf(" b/");
      if (separator >= 0 && separator === paths.lastIndexOf(" b/")) {
        return [paths.slice(0, separator), paths.slice(separator + 1)];
      }
      if (separator >= 0) {
        return [];
      }
    }

    const twoPaths = /^(\S+) (\S+)$/.exec(paths);
    return twoPaths ? [twoPaths[1] ?? "", twoPaths[2] ?? ""] : [];
  }

  for (const prefix of ["--- ", "+++ ", "Index: "]) {
    if (line.startsWith(prefix)) {
      const pathWithTimestamp = line.slice(prefix.length);
      return [pathWithTimestamp.split("\t", 1)[0] ?? ""];
    }
  }

  const applyPatchHeader = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line);
  return applyPatchHeader ? [applyPatchHeader[1] ?? ""] : [];
};

const hasPrefixedGitHeader = (lines: string[]): boolean => {
  const hunkIndex = lines.findIndex((line) => line.startsWith("@@"));
  const headerLines = hunkIndex >= 0 ? lines.slice(0, hunkIndex) : lines;
  const header = headerLines.find((line) => line.startsWith("diff --git "));
  if (!header) {
    return false;
  }
  const [oldHeader, newHeader] = diffHeaderPaths(header);
  const oldPath = decodeGitQuotedPath(oldHeader ?? "");
  const newPath = decodeGitQuotedPath(newHeader ?? "");
  if (oldPath && oldPath === newPath) {
    return false;
  }
  return (
    (oldPath?.startsWith("a/") && newPath?.startsWith("b/")) ||
    (header.startsWith("diff --git a/") && header.includes(" b/"))
  );
};

const standaloneGitPath = (lines: string[], changeType?: string | null): string | null => {
  if (changeType !== "added" && changeType !== "deleted" && changeType !== "modified") {
    return null;
  }

  const hunkIndex = lines.findIndex((line) => line.startsWith("@@"));
  const headers = hunkIndex >= 0 ? lines.slice(0, hunkIndex) : lines;
  if (headers.some((line) => line.startsWith("diff --git ") || line.startsWith("Index: "))) {
    return null;
  }

  for (const [index, line] of headers.entries()) {
    const nextLine = headers[index + 1];
    if (!line.startsWith("--- ") || !nextLine?.startsWith("+++ ")) {
      continue;
    }
    const oldHeader = diffHeaderPaths(line)[0] ?? "";
    const newHeader = diffHeaderPaths(nextLine)[0] ?? "";
    const oldPath = decodeGitQuotedPath(oldHeader);
    const newPath = decodeGitQuotedPath(newHeader);
    if (changeType === "added" && oldPath === "/dev/null" && newPath?.startsWith("b/")) {
      return newHeader;
    }
    if (changeType === "deleted" && newPath === "/dev/null" && oldPath?.startsWith("a/")) {
      return oldHeader;
    }
    if (
      changeType === "modified" &&
      oldPath?.startsWith("a/") &&
      newPath?.startsWith("b/") &&
      oldPath.slice(2) === newPath.slice(2)
    ) {
      return newHeader;
    }
  }
  return null;
};

const fileDiffCandidateMatch = (
  candidate: string,
  filePath: string,
  changeType?: string | null,
): DiffPathMatch | null => {
  const lines = normalizeNewlines(candidate).split("\n");
  const stripGitPrefix = hasPrefixedGitHeader(lines);
  let hasUnifiedHeader = false;
  let hasGitPathMetadata = false;
  let unifiedMatch: DiffPathMatch | null = null;
  let gitPathMetadataMatch: DiffPathMatch | null = null;
  let otherHeaderMatch: DiffPathMatch | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      break;
    }

    const gitPathMetadata = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
    if (gitPathMetadata) {
      hasGitPathMetadata = true;
      gitPathMetadataMatch = strongerDiffPathMatch(
        gitPathMetadataMatch,
        diffPathsMatch(gitPathMetadata[1] ?? "", filePath, false),
      );
      continue;
    }

    let lineMatch: DiffPathMatch | null = null;
    for (const headerPath of diffHeaderPaths(line)) {
      lineMatch = strongerDiffPathMatch(
        lineMatch,
        diffPathsMatch(headerPath, filePath, stripGitPrefix && !line.startsWith("Index: ")),
      );
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      hasUnifiedHeader = true;
      unifiedMatch = strongerDiffPathMatch(unifiedMatch, lineMatch);
    } else {
      otherHeaderMatch = strongerDiffPathMatch(otherHeaderMatch, lineMatch);
    }
  }

  if (hasGitPathMetadata) {
    return gitPathMetadataMatch;
  }
  if (hasUnifiedHeader) {
    const gitPath = standaloneGitPath(lines, changeType);
    const gitMatch = gitPath ? diffPathsMatch(gitPath, filePath, true) : null;
    // An exact literal path wins when the headers could name a real a/ or b/ folder.
    return strongerDiffPathMatch(
      unifiedMatch,
      gitMatch && { exact: false, matchedLength: gitMatch.matchedLength },
    );
  }
  return otherHeaderMatch;
};

export const fileDiffCandidateMatchesFile = (candidate: string, filePath: string): boolean =>
  fileDiffCandidateMatch(candidate, filePath) !== null;

const hasExplicitFileHeader = (candidate: string): boolean => {
  for (const line of normalizeNewlines(candidate).trim().split("\n")) {
    if (line.startsWith("@@")) {
      return false;
    }
    if (line.startsWith("diff --git ") || diffHeaderPaths(line).length > 0) {
      return true;
    }
  }

  return false;
};

export const countRenderableFileDiffLines = (diff: string): FileDiffLineCounts => {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;

  for (const line of normalizeNewlines(diff).split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk && (line.startsWith("+++ ") || line.startsWith("--- "))) {
      continue;
    }
    if (line.startsWith("+")) {
      additions++;
      continue;
    }
    if (line.startsWith("-")) {
      deletions++;
    }
  }

  return { additions, deletions };
};
