import { getSingularPatch } from "@pierre/diffs";
import { FileDiff, useWorkerPool } from "@pierre/diffs/react";
import { type CSSProperties, memo, type ReactElement, useEffect, useMemo } from "react";
import { useTheme } from "@/components/layout/theme-provider";
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

const tryGetSingularPatch = (patch: string) => {
  try {
    return getSingularPatch(patch);
  } catch {
    return null;
  }
};

export const getRenderableFileDiff = (patch: string, filePath: string) => {
  const normalizedPatch = selectRenderableDiff(patch, filePath);
  const fileDiff = normalizedPatch ? tryGetSingularPatch(normalizedPatch) : null;

  return {
    fileDiff,
    normalizedPatch,
    fallbackPatch: normalizedPatch ?? patch,
  };
};

export const PierreDiffPreloader = memo(function PierreDiffPreloader({
  patch,
  filePath,
}: PierreDiffPreloaderProps): null {
  const workerPool = useWorkerPool();
  const { fileDiff, normalizedPatch } = useMemo(
    () => getRenderableFileDiff(patch, filePath),
    [filePath, patch],
  );
  const preloadRenderer = useMemo(
    () => ({
      onHighlightSuccess: (_diff: unknown, _result: unknown, _options: unknown) => undefined,
      onHighlightError: (_error: unknown) => undefined,
    }),
    [],
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
  className,
}: PierreDiffViewerProps): ReactElement {
  const { theme } = useTheme();
  const { fileDiff, fallbackPatch } = useMemo(
    () => getRenderableFileDiff(patch, filePath),
    [filePath, patch],
  );
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
      {fileDiff ? (
        <FileDiff fileDiff={fileDiff} options={options} />
      ) : (
        <pre className={RAW_DIFF_FALLBACK_CLASS_NAME}>{fallbackPatch}</pre>
      )}
    </div>
  );
});
