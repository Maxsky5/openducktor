import type { DiffLineAnnotation, FileDiffMetadata, Hunk } from "@pierre/diffs";
import { getSingularPatch } from "@pierre/diffs";
import { FileDiff as PierreReactFileDiff, useWorkerPool } from "@pierre/diffs/react";
import type { DiffRendererInstance } from "@pierre/diffs/worker";
import { Undo2 } from "lucide-react";
import { type CSSProperties, memo, type ReactElement, useEffect, useId, useMemo } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { selectRenderableDiff } from "./renderable-patch";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PierreDiffStyle = "split" | "unified";

type PierreDiffViewerProps = {
  /** Raw unified diff / patch string (e.g. from `git diff`). */
  patch: string;
  filePath: string;
  /** Split (side-by-side) or unified (single-column) view. */
  diffStyle?: PierreDiffStyle;
  /** Enable click-to-select on line numbers. */
  enableLineSelection?: boolean;
  enableHunkReset?: boolean;
  isHunkResetDisabled?: boolean;
  onResetHunk?: ((hunkIndex: number) => void) | undefined;
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
      metadata: { hunkIndex },
    };
  }

  if (lastDeletionLine != null) {
    return {
      side: "deletions",
      lineNumber: lastDeletionLine,
      metadata: { hunkIndex },
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

// ─── Component ─────────────────────────────────────────────────────────────────

export const PierreDiffViewer = memo(function PierreDiffViewer({
  patch,
  filePath,
  diffStyle = "split",
  enableLineSelection = false,
  enableHunkReset = false,
  isHunkResetDisabled = false,
  onResetHunk,
  className,
}: PierreDiffViewerProps): ReactElement {
  const { theme } = useTheme();
  const { fileDiff, fallbackPatch } = useMemo(
    () => getRenderableFileDiff(patch, filePath),
    [filePath, patch],
  );
  const lineDiffType: "word-alt" | "none" = diffStyle === "split" ? "word-alt" : "none";
  const lineAnnotations = useMemo(
    () =>
      enableHunkReset && fileDiff != null && onResetHunk != null
        ? getHunkResetAnnotations(fileDiff)
        : [],
    [enableHunkReset, fileDiff, onResetHunk],
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
      ...(enableHunkReset ? { unsafeCSS: HUNK_RESET_FLOATING_CSS } : {}),
    }),
    [diffStyle, enableHunkReset, enableLineSelection, lineDiffType, theme],
  );

  let content: ReactElement;
  if (fileDiff == null) {
    content = <pre className={RAW_DIFF_FALLBACK_CLASS_NAME}>{fallbackPatch}</pre>;
  } else {
    content = (
      <div className={DIFF_SCROLL_CONTAINER_CLASS_NAME}>
        <PierreReactFileDiff
          fileDiff={fileDiff}
          options={options}
          lineAnnotations={lineAnnotations}
          renderAnnotation={(annotation) => (
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
                  onClick={() => onResetHunk?.(annotation.metadata.hunkIndex)}
                >
                  <Undo2 className="size-3.5" />
                  <span>Reset hunk</span>
                </Button>
              </div>
            </div>
          )}
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
