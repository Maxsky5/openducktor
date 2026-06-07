export type FileDiffLineCounts = {
  additions: number;
  deletions: number;
};

export type SelectRenderableFileDiffOptions = {
  changeType?: string | null;
};

const GIT_DIFF_HEADER = /^diff --git /m;
const CLASSIC_DIFF_HEADER = /^Index: /m;
const UNIFIED_MULTI_FILE_HEADER = /^--- .+\n\+\+\+ .+/m;
const APPLY_PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete) File: /m;

const normalizeNewlines = (value: string): string => value.replace(/\r\n?/g, "\n");

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

const splitTrimmedNonEmpty = (value: string, separator: RegExp): string[] => {
  return value.split(separator).reduce<string[]>((chunks, chunk) => {
    const trimmed = chunk.trim();
    if (trimmed.length > 0) {
      chunks.push(trimmed);
    }
    return chunks;
  }, []);
};

const applyPatchFileContentDiff = (candidate: string, filePath: string): string | null => {
  const lines = candidate.trim().split("\n");
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
  const trimmed = normalizeNewlines(candidate).trim();
  if (trimmed.length === 0) {
    return null;
  }

  const applyPatchDiff = applyPatchFileContentDiff(trimmed, filePath);
  if (applyPatchDiff) {
    return applyPatchDiff;
  }

  const lines = trimmed.split("\n");
  const markerIndex = lines.findIndex(
    (line) => line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("@@"),
  );
  if (markerIndex < 0) {
    return null;
  }

  const rawRelevantLines = lines.slice(markerIndex);
  const endPatchIndex = rawRelevantLines.findIndex((line, index) =>
    index > 0 ? line.startsWith("*** End Patch") : false,
  );
  const relevantLines =
    endPatchIndex >= 0 ? rawRelevantLines.slice(0, endPatchIndex) : rawRelevantLines;
  const normalized = relevantLines.join("\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  if (normalized.startsWith("@@")) {
    const diffPath = toDiffHeaderPath(filePath);
    return `--- a/${diffPath}\n+++ b/${diffPath}\n${normalized}\n`;
  }

  return `${normalized}\n`;
};

export const splitFileDiffCandidates = (rawDiff: string): string[] => {
  const trimmed = normalizeNewlines(rawDiff).trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (GIT_DIFF_HEADER.test(trimmed)) {
    return splitTrimmedNonEmpty(trimmed, /(?=^diff --git )/m);
  }

  if (CLASSIC_DIFF_HEADER.test(trimmed)) {
    return splitTrimmedNonEmpty(trimmed, /(?=^Index: )/m);
  }

  if (UNIFIED_MULTI_FILE_HEADER.test(trimmed)) {
    return splitTrimmedNonEmpty(trimmed, /(?=^--- .+\n\+\+\+ .+)/m);
  }

  if (APPLY_PATCH_FILE_HEADER.test(trimmed)) {
    const patchBody = trimmed
      .replace(/^\*\*\* Begin Patch\s*\n?/m, "")
      .replace(/\n?\*\*\* End Patch\s*$/m, "");
    return splitTrimmedNonEmpty(patchBody, /(?=^\*\*\* (?:Add|Update|Delete) File: )/m);
  }

  return [trimmed];
};

const normalizeDiffFilePath = (filePath: string): string =>
  filePath
    .trim()
    .replaceAll("\\", "/")
    .replace(/^["']|["']$/g, "")
    .replace(/^\.\//, "");

const normalizeHeaderFilePath = (filePath: string): string =>
  normalizeDiffFilePath(filePath).replace(/^(?:a|b)\//, "");

const isAbsoluteDiffPath = (filePath: string): boolean =>
  filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath);

const diffPathsMatch = (headerPath: string, filePath: string): boolean => {
  const header = normalizeHeaderFilePath(headerPath);
  const requested = normalizeDiffFilePath(filePath);
  if (header.length === 0 || requested.length === 0 || header === "/dev/null") {
    return false;
  }
  if (header === requested) {
    return true;
  }
  if (isAbsoluteDiffPath(requested) && !isAbsoluteDiffPath(header)) {
    return requested.endsWith(`/${header}`);
  }
  if (isAbsoluteDiffPath(header) && !isAbsoluteDiffPath(requested)) {
    return header.endsWith(`/${requested}`);
  }
  return false;
};

const diffHeaderPaths = (line: string): string[] => {
  const gitHeader = /^diff --git\s+(\S+)\s+(\S+)$/.exec(line);
  if (gitHeader) {
    return [gitHeader[1] ?? "", gitHeader[2] ?? ""];
  }

  for (const prefix of ["--- ", "+++ ", "Index: "]) {
    if (line.startsWith(prefix)) {
      return [line.slice(prefix.length).split(/\s+/)[0] ?? ""];
    }
  }

  const applyPatchHeader = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line);
  return applyPatchHeader ? [applyPatchHeader[1] ?? ""] : [];
};

export const fileDiffCandidateMatchesFile = (candidate: string, filePath: string): boolean => {
  for (const line of normalizeNewlines(candidate).replaceAll("\\", "/").split("\n")) {
    if (line.startsWith("@@")) {
      break;
    }

    if (diffHeaderPaths(line).some((headerPath) => diffPathsMatch(headerPath, filePath))) {
      return true;
    }
  }

  return false;
};

const hasExplicitFileHeader = (candidate: string): boolean => {
  for (const line of normalizeNewlines(candidate).trim().split("\n")) {
    if (line.startsWith("@@")) {
      return false;
    }
    if (diffHeaderPaths(line).length > 0) {
      return true;
    }
  }

  return false;
};

export const selectRenderableFileDiff = (
  rawDiff: string,
  filePath: string,
  options: SelectRenderableFileDiffOptions = {},
): string | null => {
  const candidates = splitFileDiffCandidates(rawDiff);
  if (candidates.length === 0) {
    return null;
  }

  const matchingCandidate = candidates.find((candidate) =>
    fileDiffCandidateMatchesFile(candidate, filePath),
  );
  if (matchingCandidate) {
    return normalizeRenderableFileDiffCandidate(matchingCandidate, filePath);
  }

  const fallbackCandidate = candidates.length === 1 ? candidates[0] : null;
  if (fallbackCandidate && !hasExplicitFileHeader(fallbackCandidate)) {
    const normalizedCandidate = normalizeRenderableFileDiffCandidate(fallbackCandidate, filePath);
    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  const fullFileDiffMode = fullFileDiffModeFromChangeType(options.changeType);
  if (fullFileDiffMode) {
    return fullFileContentDiff(rawDiff, filePath, fullFileDiffMode);
  }

  return null;
};

export const countRenderableFileDiffLines = (diff: string): FileDiffLineCounts => {
  let additions = 0;
  let deletions = 0;

  for (const line of normalizeNewlines(diff).split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
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
