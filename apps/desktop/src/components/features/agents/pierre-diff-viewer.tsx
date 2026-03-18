import { getSingularPatch } from "@pierre/diffs";
import { FileDiff, useWorkerPool } from "@pierre/diffs/react";
import type { DiffRendererInstance } from "@pierre/diffs/worker";
import { Undo2 } from "lucide-react";
import { type CSSProperties, memo, type ReactElement, useEffect, useId, useMemo } from "react";
import { createRoot } from "react-dom/client";
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
const HUNK_RESET_SEPARATOR_CLASS_NAME =
  "flex items-center justify-between gap-3 border-b border-border/50 bg-muted/15 px-3 py-2 text-[11px] text-muted-foreground";
const HUNK_RESET_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60";

type CreateRootLike = (container: Element | DocumentFragment) => {
  render: (node: ReactElement) => void;
};

export function buildHunkResetSeparator(
  filePath: string,
  hunkIndex: number,
  disabled: boolean,
  onResetHunk: (hunkIndex: number) => void,
  documentRef: Pick<Document, "createElement"> = document,
  createRootImpl: CreateRootLike = createRoot,
): HTMLElement {
  const container = documentRef.createElement("div");
  container.className = HUNK_RESET_SEPARATOR_CLASS_NAME;

  const label = documentRef.createElement("span");
  label.className = "truncate font-medium text-foreground";
  label.textContent = `Chunk ${hunkIndex + 1}`;

  const button = documentRef.createElement("button");
  button.className = HUNK_RESET_BUTTON_CLASS_NAME;
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", "Reset chunk");
  button.setAttribute("title", `Reset chunk in ${filePath}`);
  button.setAttribute("data-testid", "agent-studio-git-reset-hunk-button");
  button.disabled = disabled;

  const iconHost = documentRef.createElement("span");
  iconHost.className = "pointer-events-none inline-flex items-center";
  createRootImpl(iconHost).render(<Undo2 className="size-3.5" />);

  const labelText = documentRef.createElement("span");
  labelText.textContent = "Reset chunk";

  button.append(iconHost, labelText);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (button.disabled) {
      return;
    }
    onResetHunk(hunkIndex);
  });

  container.append(label, button);
  return container;
}

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
  const hunkSeparators = useMemo(() => {
    if (!enableHunkReset || fileDiff == null || onResetHunk == null) {
      return "line-info" as const;
    }

    return (hunk: { hunkIndex: number }) =>
      buildHunkResetSeparator(filePath, hunk.hunkIndex, isHunkResetDisabled, onResetHunk);
  }, [enableHunkReset, fileDiff, filePath, isHunkResetDisabled, onResetHunk]);
  const options = useMemo(
    () => ({
      theme: DIFF_THEME,
      themeType: theme,
      diffStyle,
      diffIndicators: "bars" as const,
      hunkSeparators,
      lineDiffType,
      overflow: "wrap" as const,
      disableFileHeader: true,
      enableLineSelection,
    }),
    [diffStyle, enableLineSelection, hunkSeparators, lineDiffType, theme],
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
