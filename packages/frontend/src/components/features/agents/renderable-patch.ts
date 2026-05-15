import { getSingularPatch } from "@pierre/diffs";

const GIT_DIFF_HEADER = /^diff --git /m;
const CLASSIC_DIFF_HEADER = /^Index: /m;
const UNIFIED_MULTI_FILE_HEADER = /^--- .+\n\+\+\+ .+/m;
const APPLY_PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete) File: /m;

function applyPatchFileContentDiff(candidate: string, filePath: string): string | null {
  const lines = candidate.trim().split("\n");
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
    return ["--- /dev/null", `+++ b/${filePath}`, `@@ -0,0 +1,${lineCount} @@`, ...body, ""].join(
      "\n",
    );
  }

  return [`--- a/${filePath}`, "+++ /dev/null", `@@ -1,${lineCount} +0,0 @@`, ...body, ""].join(
    "\n",
  );
}

export function normalizePatchCandidate(candidate: string, filePath: string): string {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const applyPatchDiff = applyPatchFileContentDiff(trimmed, filePath);
  if (applyPatchDiff) {
    return applyPatchDiff;
  }

  const lines = trimmed.split("\n");
  const markerIndex = lines.findIndex(
    (line) => line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("@@"),
  );
  const rawRelevantLines = markerIndex >= 0 ? lines.slice(markerIndex) : lines;
  const endPatchIndex = rawRelevantLines.findIndex((line, index) =>
    index > 0 ? line.startsWith("*** End Patch") : false,
  );
  const relevantLines =
    endPatchIndex >= 0 ? rawRelevantLines.slice(0, endPatchIndex) : rawRelevantLines;
  const normalized = relevantLines.join("\n").trim();

  if (normalized.startsWith("@@")) {
    return `--- a/${filePath}\n+++ b/${filePath}\n${normalized}\n`;
  }

  return `${normalized}\n`;
}

function splitTrimmedNonEmpty(value: string, separator: RegExp): string[] {
  return value.split(separator).reduce<string[]>((chunks, chunk) => {
    const trimmed = chunk.trim();
    if (trimmed.length > 0) {
      chunks.push(trimmed);
    }
    return chunks;
  }, []);
}

export function splitPatchCandidates(rawDiff: string): string[] {
  const trimmed = rawDiff.trim();
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
}

export function patchMatchesFile(candidate: string, filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const quotedPath = normalizedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffixPattern = new RegExp(`(^|[\\s"'])((a|b)/)?${quotedPath}($|[\\s"'])`, "m");
  const headerLines: string[] = [];

  for (const line of candidate.replaceAll("\\", "/").split("\n")) {
    if (line.startsWith("@@")) {
      break;
    }

    headerLines.push(line);
  }

  return suffixPattern.test(headerLines.join("\n"));
}

function canParseSingularPatch(candidate: string, filePath: string): boolean {
  if (candidate.trim().length === 0) {
    return false;
  }

  try {
    getSingularPatch(normalizePatchCandidate(candidate, filePath));
    return true;
  } catch {
    return false;
  }
}

export function selectRenderableDiff(rawDiff: string, filePath: string): string | null {
  const candidates = splitPatchCandidates(rawDiff);
  if (candidates.length === 0) {
    return null;
  }

  const matchingCandidate = candidates.find((candidate) => patchMatchesFile(candidate, filePath));
  if (matchingCandidate) {
    return normalizePatchCandidate(matchingCandidate, filePath);
  }

  const singularCandidate = candidates.find((candidate) =>
    canParseSingularPatch(candidate, filePath),
  );
  if (singularCandidate) {
    return normalizePatchCandidate(singularCandidate, filePath);
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizePatchCandidate(candidate, filePath);
    if (normalizedCandidate.trim().length > 0) {
      return normalizedCandidate;
    }
  }

  return null;
}
