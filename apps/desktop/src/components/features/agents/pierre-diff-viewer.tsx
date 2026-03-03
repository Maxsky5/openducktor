import { getSingularPatch } from "@pierre/diffs";
import { PatchDiff, useWorkerPool } from "@pierre/diffs/react";
import { type CSSProperties, memo, type ReactElement, useEffect, useMemo } from "react";
import { useTheme } from "@/components/layout/theme-provider";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PierreDiffStyle = "split" | "unified";

export type PierreDiffViewerProps = {
  /** Raw unified diff / patch string (e.g. from `git diff`). */
  patch: string;
  /** Split (side-by-side) or unified (single-column) view. */
  diffStyle?: PierreDiffStyle;
  /** Enable click-to-select on line numbers. */
  enableLineSelection?: boolean;
  /** CSS class applied to the wrapper. */
  className?: string;
};

type PierreDiffPreloaderProps = {
  patch: string;
};

const DIFF_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;
const DIFF_WRAPPER_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "1.5",
  "--diffs-tab-size": 2,
} as CSSProperties;

export const PierreDiffPreloader = memo(function PierreDiffPreloader({
  patch,
}: PierreDiffPreloaderProps): null {
  const workerPool = useWorkerPool();
  const fileDiff = useMemo(() => getSingularPatch(patch), [patch]);
  const preloadRenderer = useMemo(
    () => ({
      onHighlightSuccess: (_diff: unknown, _result: unknown, _options: unknown) => undefined,
      onHighlightError: (_error: unknown) => undefined,
    }),
    [],
  );

  useEffect(() => {
    if (workerPool == null || patch.trim().length === 0) {
      return;
    }
    if (workerPool.getDiffResultCache(fileDiff) != null) {
      return;
    }

    workerPool.highlightDiffAST(preloadRenderer, fileDiff);
  }, [fileDiff, patch, preloadRenderer, workerPool]);

  return null;
});

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * Thin wrapper around Pierre's `PatchDiff` React component.
 *
 * Renders a unified diff / patch string with syntax highlighting,
 * line numbers, and inline change highlighting.
 *
 * @see https://diffs.com/docs#react-api
 */
export const PierreDiffViewer = memo(function PierreDiffViewer({
  patch,
  diffStyle = "split",
  enableLineSelection = false,
  className,
}: PierreDiffViewerProps): ReactElement {
  const { theme } = useTheme();
  const lineDiffType: "word-alt" | "none" = diffStyle === "split" ? "word-alt" : "none";
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
    }),
    [diffStyle, enableLineSelection, lineDiffType, theme],
  );

  return (
    <div className={className} style={DIFF_WRAPPER_STYLE}>
      <PatchDiff patch={patch} options={options} />
    </div>
  );
});
