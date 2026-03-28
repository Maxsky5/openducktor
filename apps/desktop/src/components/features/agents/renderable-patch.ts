import { getSingularPatch } from "@pierre/diffs";

const GIT_DIFF_HEADER = /^diff --git /m;
const CLASSIC_DIFF_HEADER = /^Index: /m;
const UNIFIED_MULTI_FILE_HEADER = /^--- .+\n\+\+\+ .+/m;

export function normalizePatchCandidate(candidate: string, filePath: string): string {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const lines = trimmed.split("\n");
  const markerIndex = lines.findIndex(
    (line) => line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("@@ "),
  );
  const relevantLines = markerIndex >= 0 ? lines.slice(markerIndex) : lines;
  const normalized = relevantLines.join("\n").trim();

  if (normalized.startsWith("@@ ")) {
    return `--- a/${filePath}\n+++ b/${filePath}\n${normalized}\n`;
  }

  return `${normalized}\n`;
}

export function splitPatchCandidates(rawDiff: string): string[] {
  const trimmed = rawDiff.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (GIT_DIFF_HEADER.test(trimmed)) {
    return trimmed
      .split(/(?=^diff --git )/m)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
  }

  if (CLASSIC_DIFF_HEADER.test(trimmed)) {
    return trimmed
      .split(/(?=^Index: )/m)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
  }

  if (UNIFIED_MULTI_FILE_HEADER.test(trimmed)) {
    return trimmed
      .split(/(?=^--- .+\n\+\+\+ .+)/m)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
  }

  return [trimmed];
}

export function patchMatchesFile(candidate: string, filePath: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const quotedPath = normalizedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffixPattern = new RegExp(`(^|[\\s"'])((a|b)/)?${quotedPath}($|[\\s"'])`, "m");
  const headerLines: string[] = [];

  for (const line of candidate.replaceAll("\\", "/").split("\n")) {
    if (line.startsWith("@@ ")) {
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
