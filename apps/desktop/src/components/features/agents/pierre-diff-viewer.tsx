import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  Hunk,
  SelectedLineRange,
  SelectionSide,
} from "@pierre/diffs";
import { getSingularPatch } from "@pierre/diffs";
import { FileDiff as PierreReactFileDiff, useWorkerPool } from "@pierre/diffs/react";
import type { DiffRendererInstance } from "@pierre/diffs/worker";
import { Undo2 } from "lucide-react";
import {
  type CSSProperties,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
} from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  InlineCommentContextLine,
  InlineCommentSide,
} from "@/state/use-inline-comment-draft-store";
import { selectRenderableDiff } from "./renderable-patch";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PierreDiffStyle = "split" | "unified";

export type PierreDiffSelection = {
  selectedLines: SelectedLineRange;
  side: InlineCommentSide;
  startLine: number;
  endLine: number;
  codeContext: InlineCommentContextLine[];
  language: string | null;
};

type PierreDiffViewerProps = {
  /** Raw unified diff / patch string (e.g. from `git diff`). */
  patch: string;
  filePath: string;
  /** Split (side-by-side) or unified (single-column) view. */
  diffStyle?: PierreDiffStyle;
  /** Enable click-to-select on line numbers. */
  enableLineSelection?: boolean;
  enableGutterUtility?: boolean;
  enableHunkReset?: boolean;
  isHunkResetDisabled?: boolean;
  onResetHunk?: ((hunkIndex: number) => void) | undefined;
  selectedLines?: SelectedLineRange | null;
  onLineSelectionEnd?: ((selection: PierreDiffSelection | null) => void) | undefined;
  lineAnnotations?: DiffLineAnnotation<unknown>[];
  renderAnnotation?: ((annotation: DiffLineAnnotation<unknown>) => ReactElement | null) | undefined;
  /** CSS class applied to the wrapper. */
  className?: string;
};

type PierreDiffPreloaderProps = {
  patch: string;
  filePath: string;
};

const DIFF_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;
const DIFF_WRAPPER_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "1.5",
  "--diffs-tab-size": 2,
} as CSSProperties;
const RAW_DIFF_FALLBACK_CLASS_NAME =
  "overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-5 text-foreground";
const HUNK_RESET_ANNOTATION_CLASS_NAME = "pointer-events-none relative h-0";
const HUNK_RESET_ANNOTATION_WRAPPER_CLASS_NAME = "contents";
const HUNK_RESET_BUTTON_CLASS_NAME =
  "pointer-events-auto absolute right-3 top-1 h-7 gap-1.5 px-2.5 text-[11px] shadow-sm";
const MAX_RENDERABLE_DIFF_CACHE_ENTRIES = 64;
const DIFF_SCROLL_CONTAINER_CLASS_NAME = "max-h-[min(70vh,48rem)] overflow-auto";
const HUNK_RESET_FLOATING_CSS = `
[data-line-annotation],
[data-gutter-buffer='annotation'] {
  --diffs-line-bg: transparent;
  min-height: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  background-color: transparent !important;
}

[data-line-annotation] [data-annotation-content] {
  position: relative;
  min-height: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  background-color: transparent !important;
}
`;

type HunkResetAnnotationMetadata = {
  kind: "hunk-reset";
  hunkIndex: number;
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
  return fileDiff.hunks
    .map((hunk, hunkIndex) => resolveHunkResetAnchor(hunk, hunkIndex))
    .filter(
      (annotation): annotation is DiffLineAnnotation<HunkResetAnnotationMetadata> =>
        annotation != null,
    );
};

const tryGetSingularPatch = (patch: string) => {
  try {
    return getSingularPatch(patch);
  } catch {
    return null;
  }
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

const INLINE_COMMENT_CONTEXT_RADIUS = 2;
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

export const PierreDiffPreloader = memo(function PierreDiffPreloader({
  patch,
  filePath,
}: PierreDiffPreloaderProps): null {
  const workerPool = useWorkerPool();
  const preloadRendererId = useId();
  const { fileDiff, normalizedPatch } = useMemo(
    () => getRenderableFileDiff(patch, filePath),
    [filePath, patch],
  );
  const preloadRenderer = useMemo<DiffRendererInstance>(
    () => ({
      __id: `pierre-diff-preloader:${preloadRendererId}`,
      onHighlightSuccess: (_diff: unknown, _result: unknown, _options: unknown) => undefined,
      onHighlightError: (_error: unknown) => undefined,
    }),
    [preloadRendererId],
  );

  useEffect(() => {
    if (workerPool == null || fileDiff == null || normalizedPatch == null) {
      return;
    }
    if (workerPool.getDiffResultCache(fileDiff) != null) {
      return;
    }

    workerPool.highlightDiffAST(preloadRenderer, fileDiff);
  }, [fileDiff, normalizedPatch, preloadRenderer, workerPool]);

  return null;
});

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

// ─── Component ─────────────────────────────────────────────────────────────────

export const PierreDiffViewer = memo(function PierreDiffViewer({
  patch,
  filePath,
  diffStyle = "split",
  enableLineSelection = false,
  enableGutterUtility = false,
  enableHunkReset = false,
  isHunkResetDisabled = false,
  onResetHunk,
  selectedLines = null,
  onLineSelectionEnd,
  lineAnnotations = [],
  renderAnnotation,
  className,
}: PierreDiffViewerProps): ReactElement {
  const { theme } = useTheme();
  const { fileDiff, fallbackPatch } = useMemo(
    () => getRenderableFileDiff(patch, filePath),
    [filePath, patch],
  );
  const lineDiffType: "word-alt" | "none" = diffStyle === "split" ? "word-alt" : "none";
  const mergedLineAnnotations = useMemo(
    () =>
      enableHunkReset && fileDiff != null && onResetHunk != null
        ? [...lineAnnotations, ...getHunkResetAnnotations(fileDiff)]
        : lineAnnotations,
    [enableHunkReset, fileDiff, lineAnnotations, onResetHunk],
  );
  const handleLineSelectionEnd = useMemo(
    () =>
      onLineSelectionEnd && fileDiff != null
        ? (range: SelectedLineRange | null) => {
            onLineSelectionEnd(buildPierreDiffSelection(fileDiff, range));
          }
        : undefined,
    [fileDiff, onLineSelectionEnd],
  );
  const options = useMemo(
    () => ({
      theme: DIFF_THEME,
      themeType: theme,
      diffStyle,
      diffIndicators: "bars" as const,
      hunkSeparators: "line-info" as const,
      lineDiffType,
      overflow: "wrap" as const,
      disableFileHeader: true,
      enableLineSelection,
      enableGutterUtility,
      ...(handleLineSelectionEnd ? { onLineSelectionEnd: handleLineSelectionEnd } : {}),
      ...(enableHunkReset ? { unsafeCSS: HUNK_RESET_FLOATING_CSS } : {}),
    }),
    [
      diffStyle,
      enableGutterUtility,
      enableHunkReset,
      enableLineSelection,
      handleLineSelectionEnd,
      lineDiffType,
      theme,
    ],
  );
  const handleRenderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<unknown>) => {
      const metadata = annotation.metadata;
      if (
        metadata != null &&
        typeof metadata === "object" &&
        "kind" in metadata &&
        metadata.kind === "hunk-reset"
      ) {
        const hunkResetMetadata = metadata as HunkResetAnnotationMetadata;
        return (
          <div className={HUNK_RESET_ANNOTATION_WRAPPER_CLASS_NAME}>
            <div className={HUNK_RESET_ANNOTATION_CLASS_NAME}>
              <Button
                className={HUNK_RESET_BUTTON_CLASS_NAME}
                variant="outline"
                size="sm"
                aria-label="Reset hunk"
                title={`Reset hunk in ${filePath}`}
                data-testid="agent-studio-git-reset-hunk-button"
                disabled={isHunkResetDisabled}
                onClick={() => onResetHunk?.(hunkResetMetadata.hunkIndex)}
              >
                <Undo2 className="size-3.5" />
                <span>Reset hunk</span>
              </Button>
            </div>
          </div>
        );
      }

      return renderAnnotation?.(annotation) ?? null;
    },
    [filePath, isHunkResetDisabled, onResetHunk, renderAnnotation],
  );

  let content: ReactElement;
  if (fileDiff == null) {
    content = <pre className={RAW_DIFF_FALLBACK_CLASS_NAME}>{fallbackPatch}</pre>;
  } else {
    content = (
      <div className={DIFF_SCROLL_CONTAINER_CLASS_NAME}>
        <PierreReactFileDiff
          fileDiff={fileDiff}
          selectedLines={selectedLines}
          options={options}
          lineAnnotations={mergedLineAnnotations}
          renderAnnotation={handleRenderAnnotation}
        />
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)} style={DIFF_WRAPPER_STYLE}>
      {content}
    </div>
  );
});
