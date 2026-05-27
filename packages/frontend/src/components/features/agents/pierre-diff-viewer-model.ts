import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  Hunk,
  SelectedLineRange,
  SelectionSide,
} from "@pierre/diffs";
import { getSingularPatch } from "@pierre/diffs";
import type {
  InlineCommentContextLine,
  InlineCommentSide,
} from "@/state/use-inline-comment-draft-store";
import { selectRenderableDiff } from "./renderable-patch";

const MAX_RENDERABLE_DIFF_CACHE_ENTRIES = 64;
const INLINE_COMMENT_CONTEXT_RADIUS = 2;

export type PierreDiffSelection = {
  selectedLines: SelectedLineRange;
  side: InlineCommentSide;
  startLine: number;
  endLine: number;
  codeContext: InlineCommentContextLine[];
  language: string | null;
};

export type HunkResetAnnotationMetadata = {
  kind: "hunk-reset";
  hunkIndex: number;
};

type RenderableFileDiff = {
  fileDiff: FileDiffMetadata | null;
  normalizedPatch: string | null;
  fallbackPatch: string;
};

type DiffSideLine = {
  lineNumber: number;
  text: string;
};

const resolveHunkResetAnchor = (
  hunk: Hunk,
  hunkIndex: number,
): DiffLineAnnotation<HunkResetAnnotationMetadata> | null => {
  let currentAdditionLine = hunk.additionStart;
  let currentDeletionLine = hunk.deletionStart;
  let lastAdditionLine: number | null = null;
  let lastDeletionLine: number | null = null;

  for (const segment of hunk.hunkContent) {
    if (segment.type === "context") {
      currentAdditionLine += segment.lines;
      currentDeletionLine += segment.lines;
      continue;
    }

    if (segment.additions > 0) {
      lastAdditionLine = currentAdditionLine + segment.additions - 1;
      currentAdditionLine += segment.additions;
    }

    if (segment.deletions > 0) {
      lastDeletionLine = currentDeletionLine + segment.deletions - 1;
      currentDeletionLine += segment.deletions;
    }
  }

  if (lastAdditionLine != null) {
    return {
      side: "additions",
      lineNumber: lastAdditionLine,
      metadata: { kind: "hunk-reset", hunkIndex },
    };
  }

  if (lastDeletionLine != null) {
    return {
      side: "deletions",
      lineNumber: lastDeletionLine,
      metadata: { kind: "hunk-reset", hunkIndex },
    };
  }

  return null;
};

export const getHunkResetAnnotations = (
  fileDiff: FileDiffMetadata,
): DiffLineAnnotation<HunkResetAnnotationMetadata>[] => {
  return fileDiff.hunks.reduce<DiffLineAnnotation<HunkResetAnnotationMetadata>[]>(
    (annotations, hunk, hunkIndex) => {
      const annotation = resolveHunkResetAnchor(hunk, hunkIndex);
      if (annotation) {
        annotations.push(annotation);
      }
      return annotations;
    },
    [],
  );
};

const tryGetSingularPatch = (patch: string) => {
  try {
    return getSingularPatch(patch);
  } catch {
    return null;
  }
};

const normalizeDiffLineText = (value: string): string => value.replace(/\n$/, "");

const renderableFileDiffCache = new Map<string, RenderableFileDiff>();

export const getRenderableFileDiff = (patch: string, filePath: string) => {
  const cacheKey = `${filePath}\u0000${patch}`;
  const cached = renderableFileDiffCache.get(cacheKey);
  if (cached) {
    renderableFileDiffCache.delete(cacheKey);
    renderableFileDiffCache.set(cacheKey, cached);
    return cached;
  }

  const normalizedPatch = selectRenderableDiff(patch, filePath);
  const fileDiff = normalizedPatch ? tryGetSingularPatch(normalizedPatch) : null;
  const result = {
    fileDiff,
    normalizedPatch,
    fallbackPatch: normalizedPatch ?? patch,
  } satisfies RenderableFileDiff;

  renderableFileDiffCache.set(cacheKey, result);
  if (renderableFileDiffCache.size > MAX_RENDERABLE_DIFF_CACHE_ENTRIES) {
    const oldestKey = renderableFileDiffCache.keys().next().value;
    if (typeof oldestKey === "string") {
      renderableFileDiffCache.delete(oldestKey);
    }
  }

  return result;
};

const normalizeSelectedLineRange = (selectedLines: SelectedLineRange): SelectedLineRange => {
  const normalizedStartSide = selectedLines.side;
  const normalizedEndSide = selectedLines.endSide ?? normalizedStartSide;

  const withOptionalSides = (
    range: Pick<SelectedLineRange, "start" | "end">,
    startSide: SelectionSide | undefined,
    endSide: SelectionSide | undefined,
  ): SelectedLineRange => {
    return {
      ...range,
      ...(startSide ? { side: startSide } : {}),
      ...(endSide ? { endSide } : {}),
    };
  };

  if (selectedLines.start < selectedLines.end) {
    return withOptionalSides(selectedLines, normalizedStartSide, normalizedEndSide);
  }

  if (selectedLines.start === selectedLines.end) {
    return withOptionalSides(
      {
        start: selectedLines.start,
        end: selectedLines.end,
      },
      normalizedStartSide,
      normalizedEndSide,
    );
  }

  return withOptionalSides(
    {
      start: selectedLines.end,
      end: selectedLines.start,
    },
    normalizedEndSide,
    normalizedStartSide,
  );
};

const mapSelectionSide = (side: SelectionSide | undefined): InlineCommentSide => {
  return side === "deletions" ? "old" : "new";
};

const buildSideLines = (fileDiff: FileDiffMetadata, side: SelectionSide): DiffSideLine[] => {
  const lines = side === "deletions" ? fileDiff.deletionLines : fileDiff.additionLines;
  const sideLines: DiffSideLine[] = [];

  for (const hunk of fileDiff.hunks) {
    let additionLineNumber = hunk.additionStart;
    let deletionLineNumber = hunk.deletionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let index = 0; index < content.lines; index += 1) {
          sideLines.push({
            lineNumber:
              side === "deletions" ? deletionLineNumber + index : additionLineNumber + index,
            text: normalizeDiffLineText(
              lines[
                (side === "deletions" ? content.deletionLineIndex : content.additionLineIndex) +
                  index
              ] ?? "",
            ),
          });
        }
        additionLineNumber += content.lines;
        deletionLineNumber += content.lines;
        continue;
      }

      if (side === "deletions") {
        for (let index = 0; index < content.deletions; index += 1) {
          sideLines.push({
            lineNumber: deletionLineNumber + index,
            text: normalizeDiffLineText(lines[content.deletionLineIndex + index] ?? ""),
          });
        }
      }

      if (side === "additions") {
        for (let index = 0; index < content.additions; index += 1) {
          sideLines.push({
            lineNumber: additionLineNumber + index,
            text: normalizeDiffLineText(lines[content.additionLineIndex + index] ?? ""),
          });
        }
      }

      additionLineNumber += content.additions;
      deletionLineNumber += content.deletions;
    }
  }

  return sideLines;
};

export const buildPierreDiffSelection = (
  fileDiff: FileDiffMetadata,
  selectedLines: SelectedLineRange | null,
): PierreDiffSelection | null => {
  if (selectedLines == null) {
    return null;
  }

  const normalizedSelection = normalizeSelectedLineRange(selectedLines);
  const startSide = normalizedSelection.side ?? "additions";
  const endSide = normalizedSelection.endSide ?? startSide;
  if (startSide !== endSide) {
    return null;
  }

  const sideLines = buildSideLines(fileDiff, startSide);
  const startIndex = sideLines.findIndex((line) => line.lineNumber === normalizedSelection.start);
  const endIndex = sideLines.findIndex((line) => line.lineNumber === normalizedSelection.end);
  if (startIndex < 0 || endIndex < 0) {
    return null;
  }

  const contextStartIndex = Math.max(0, startIndex - INLINE_COMMENT_CONTEXT_RADIUS);
  const contextEndIndex = Math.min(sideLines.length - 1, endIndex + INLINE_COMMENT_CONTEXT_RADIUS);
  const codeContext = sideLines.slice(contextStartIndex, contextEndIndex + 1).map((line, index) => {
    const absoluteIndex = contextStartIndex + index;
    return {
      lineNumber: line.lineNumber,
      text: line.text,
      isSelected: absoluteIndex >= startIndex && absoluteIndex <= endIndex,
    } satisfies InlineCommentContextLine;
  });

  return {
    selectedLines: normalizedSelection,
    side: mapSelectionSide(startSide),
    startLine: normalizedSelection.start,
    endLine: normalizedSelection.end,
    codeContext,
    language: fileDiff.lang ?? null,
  };
};
