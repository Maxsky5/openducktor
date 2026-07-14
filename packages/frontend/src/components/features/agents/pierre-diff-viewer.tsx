import {
  type BaseDiffOptions,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
  getFiletypeFromFileName,
  type SelectedLineRange,
} from "@pierre/diffs";
import {
  File as PierreReactFile,
  FileDiff as PierreReactFileDiff,
  useWorkerPool,
} from "@pierre/diffs/react";
import { Undo2 } from "lucide-react";
import {
  type CSSProperties,
  memo,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PIERRE_HIGHLIGHT_LINE_LIMIT } from "@/lib/diff/pierre-config";
import { cn } from "@/lib/utils";
import type { HunkResetAnnotationMetadata, PierreDiffSelection } from "./pierre-diff-viewer-model";
import {
  buildPierreDiffSelection,
  getHunkResetAnnotations,
  getRenderableFileDiff,
} from "./pierre-diff-viewer-model";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PierreDiffStyle = NonNullable<BaseDiffOptions["diffStyle"]>;
export type PierreDiffIndicators = NonNullable<BaseDiffOptions["diffIndicators"]>;
export type PierreLineOverflow = NonNullable<BaseDiffOptions["overflow"]>;
export type PierreHunkSeparators = Exclude<
  NonNullable<BaseDiffOptions["hunkSeparators"]>,
  "custom"
>;
export type PierreDiffHeightMode = "full" | "scroll";
export type { PierreDiffSelection } from "./pierre-diff-viewer-model";

type PierreDiffViewerProps = {
  /** Raw unified diff / patch string (e.g. from `git diff`). */
  patch: string;
  filePath: string;
  /** Split (side-by-side) or unified (single-column) view. */
  diffStyle?: PierreDiffStyle;
  diffIndicators?: PierreDiffIndicators;
  lineOverflow?: PierreLineOverflow;
  hunkSeparators?: PierreHunkSeparators;
  heightMode?: PierreDiffHeightMode;
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

type PierreFileViewerProps = {
  filePath: string;
  content: string;
  className?: string;
};

type PierreHighlightState = "ready" | "pending" | "unavailable";
type PierreWorkerPool = NonNullable<ReturnType<typeof useWorkerPool>>;
type PierreFileHighlightObserver = Parameters<PierreWorkerPool["highlightFileAST"]>[0];
type PierreDiffHighlightObserver = Parameters<PierreWorkerPool["highlightDiffAST"]>[0];
type PierreHighlightTarget =
  | { kind: "file"; file: FileContents; taskKey: string }
  | { kind: "diff"; fileDiff: FileDiffMetadata; taskKey: string };

const DIFF_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;
const DIFF_WRAPPER_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "1.5",
  "--diffs-tab-size": 2,
} as CSSProperties;
const RAW_DIFF_FALLBACK_BASE_CLASS_NAME =
  "px-3 py-2 font-mono text-[11px] leading-5 text-foreground";
const HUNK_RESET_ANNOTATION_CLASS_NAME = "pointer-events-none relative h-0";
const HUNK_RESET_ANNOTATION_WRAPPER_CLASS_NAME = "contents";
const HUNK_RESET_ANNOTATION_MARKER_ATTRIBUTE = "data-hunk-reset-annotation";
const HUNK_RESET_BUTTON_CLASS_NAME =
  "pointer-events-auto absolute right-3 top-1 h-7 gap-1.5 px-2.5 text-[11px] shadow-sm";
const PIERRE_VIEWER_SCROLL_CONTAINER_CLASS_NAME = "max-h-[min(50vh,32rem)] overflow-auto";
const PIERRE_HIGHLIGHT_SKELETON_WIDTHS = [
  "w-3/5",
  "w-4/5",
  "w-2/3",
  "w-5/6",
  "w-1/2",
  "w-3/4",
] as const;
const HUNK_RESET_FLOATING_CSS = `
[data-line-annotation]:has([${HUNK_RESET_ANNOTATION_MARKER_ATTRIBUTE}]),
[data-gutter-buffer='annotation']:has([${HUNK_RESET_ANNOTATION_MARKER_ATTRIBUTE}]) {
  --diffs-line-bg: transparent;
  min-height: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  background-color: transparent !important;
}

[data-line-annotation]:has([${HUNK_RESET_ANNOTATION_MARKER_ATTRIBUTE}]) [data-annotation-content],
[data-gutter-buffer='annotation']:has([${HUNK_RESET_ANNOTATION_MARKER_ATTRIBUTE}]) [data-annotation-content] {
  position: relative;
  min-height: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  background-color: transparent !important;
}
`;

const getPierreViewerContainerClassName = (heightMode: PierreDiffHeightMode): string =>
  cn("min-w-0", heightMode === "scroll" && PIERRE_VIEWER_SCROLL_CONTAINER_CLASS_NAME);

const getRawDiffFallbackClassName = (lineOverflow: PierreLineOverflow): string =>
  cn(
    RAW_DIFF_FALLBACK_BASE_CLASS_NAME,
    lineOverflow === "wrap" ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre",
  );

const getPierreFileHighlightState = (
  workerPool: ReturnType<typeof useWorkerPool>,
  file: FileContents,
  requiresHighlight: boolean,
  didHighlightFail: boolean,
): PierreHighlightState => {
  if (!requiresHighlight) {
    return "ready";
  }
  if (workerPool == null || !workerPool.isWorkingPool()) {
    return "unavailable";
  }
  if (workerPool.getFileResultCache(file) != null) {
    return "ready";
  }
  return didHighlightFail ? "unavailable" : "pending";
};

const getPierreDiffHighlightState = (
  workerPool: ReturnType<typeof useWorkerPool>,
  fileDiff: FileDiffMetadata | null,
  requiresHighlight: boolean,
  didHighlightFail: boolean,
): PierreHighlightState => {
  if (!requiresHighlight) {
    return "ready";
  }
  if (workerPool == null || !workerPool.isWorkingPool()) {
    return "unavailable";
  }
  if (fileDiff != null && workerPool.getDiffResultCache(fileDiff) != null) {
    return "ready";
  }
  return didHighlightFail ? "unavailable" : "pending";
};

const usePierreHighlightTaskFailure = ({
  target,
  workerPool,
  shouldStart,
}: {
  target: PierreHighlightTarget | null;
  workerPool: ReturnType<typeof useWorkerPool>;
  shouldStart: boolean;
}): boolean => {
  const reactId = useId();
  const [failedTaskKey, setFailedTaskKey] = useState<string | null>(null);
  const didHighlightFail = target != null && failedTaskKey === target.taskKey;

  useEffect(() => {
    if (!shouldStart || workerPool == null || target == null || didHighlightFail) {
      return;
    }

    const instanceId = `openducktor-highlight:${reactId}:${target.taskKey}`;
    const onHighlightError = () => setFailedTaskKey(target.taskKey);
    if (target.kind === "file") {
      const observer: PierreFileHighlightObserver = {
        __id: instanceId,
        onHighlightSuccess: () => undefined,
        onHighlightError,
      };
      workerPool.highlightFileAST(observer, target.file);
      return () => workerPool.cleanUpTasks(observer);
    }

    const observer: PierreDiffHighlightObserver = {
      __id: instanceId,
      onHighlightSuccess: () => undefined,
      onHighlightError,
    };
    workerPool.highlightDiffAST(observer, target.fileDiff);
    return () => workerPool.cleanUpTasks(observer);
  }, [didHighlightFail, reactId, shouldStart, target, workerPool]);

  return didHighlightFail;
};

const PierreHighlightSkeleton = ({
  filePath,
  testId,
}: {
  filePath: string;
  testId: string;
}): ReactElement => (
  <div
    className="col-start-1 row-start-1 space-y-2 overflow-hidden bg-background px-3 py-3"
    data-testid={testId}
    role="status"
    aria-label={`Highlighting ${filePath}`}
  >
    {PIERRE_HIGHLIGHT_SKELETON_WIDTHS.map((widthClassName) => (
      <Skeleton key={widthClassName} className={cn("h-3 rounded-sm", widthClassName)} />
    ))}
  </div>
);

const getContentMetrics = (value: string): { hash: string; lineCount: number } => {
  let hash = 0x811c9dc5;
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    hash ^= charCode;
    hash = Math.imul(hash, 0x01000193);
    if (charCode === 10) {
      lineCount += 1;
    }
  }
  return { hash: (hash >>> 0).toString(36), lineCount };
};

export const PierreDiffPreloader = memo(function PierreDiffPreloader({
  patch,
  filePath,
}: PierreDiffPreloaderProps): null {
  const workerPool = useWorkerPool();
  const { fileDiff } = useMemo(() => getRenderableFileDiff(patch, filePath), [filePath, patch]);

  useEffect(() => {
    if (workerPool == null || !workerPool.isWorkingPool() || fileDiff == null) {
      return;
    }
    if (workerPool.getDiffResultCache(fileDiff) != null) {
      return;
    }

    workerPool.primeDiffHighlightCache(fileDiff);
  }, [fileDiff, workerPool]);

  return null;
});

export const PierreFileViewer = memo(function PierreFileViewer({
  filePath,
  content,
  className,
}: PierreFileViewerProps): ReactElement {
  const { theme } = useTheme();
  const workerPool = useWorkerPool();
  const { file, fileCacheKey, lineCount } = useMemo<{
    file: FileContents;
    fileCacheKey: string;
    lineCount: number;
  }>(() => {
    const metrics = getContentMetrics(content);
    const fileCacheKey = `${filePath}:${content.length}:${metrics.hash}`;
    return {
      file: {
        name: filePath,
        contents: content,
        lang: getFiletypeFromFileName(filePath),
        cacheKey: fileCacheKey,
      },
      fileCacheKey,
      lineCount: metrics.lineCount,
    };
  }, [content, filePath]);
  const requiresHighlight =
    content.length > 0 && file.lang !== "text" && lineCount <= PIERRE_HIGHLIGHT_LINE_LIMIT;
  const highlightStateBeforeSubscription = getPierreFileHighlightState(
    workerPool,
    file,
    requiresHighlight,
    false,
  );
  const highlightTarget = useMemo<PierreHighlightTarget>(
    () => ({ kind: "file", file, taskKey: fileCacheKey }),
    [file, fileCacheKey],
  );
  const didHighlightFail = usePierreHighlightTaskFailure({
    target: highlightTarget,
    workerPool,
    shouldStart: highlightStateBeforeSubscription === "pending",
  });
  const shouldSubscribeToHighlightCache =
    highlightStateBeforeSubscription === "pending" && !didHighlightFail;
  const subscribeToHighlightCache = useCallback(
    (onStoreChange: () => void) => {
      if (!shouldSubscribeToHighlightCache || workerPool == null) {
        return () => undefined;
      }
      return workerPool.subscribeToStatChanges(onStoreChange);
    },
    [shouldSubscribeToHighlightCache, workerPool],
  );
  const getHighlightCacheSnapshot = useCallback(
    () => getPierreFileHighlightState(workerPool, file, requiresHighlight, didHighlightFail),
    [didHighlightFail, file, requiresHighlight, workerPool],
  );
  const highlightState = useSyncExternalStore(
    subscribeToHighlightCache,
    getHighlightCacheSnapshot,
    () => (requiresHighlight ? "pending" : "ready"),
  );
  const options = useMemo(
    () => ({
      theme: DIFF_THEME,
      themeType: theme,
      overflow: "wrap" as const,
      disableFileHeader: true,
      tokenizeMaxLength: PIERRE_HIGHLIGHT_LINE_LIMIT,
    }),
    [theme],
  );
  const isHighlightReady = highlightState === "ready";

  if (highlightState === "unavailable") {
    return (
      <div className={cn("min-w-0", className)} style={DIFF_WRAPPER_STYLE}>
        <div
          className="px-3 py-4 text-sm text-destructive"
          role="alert"
        >{`Syntax highlighting ${didHighlightFail ? "failed" : "is unavailable"} for ${filePath}. Reload the session to try again.`}</div>
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)} style={DIFF_WRAPPER_STYLE}>
      <div className={PIERRE_VIEWER_SCROLL_CONTAINER_CLASS_NAME}>
        <div className="grid min-w-0">
          {isHighlightReady ? (
            <div className="col-start-1 row-start-1 min-w-0">
              <PierreReactFile key={fileCacheKey} file={file} options={options} />
            </div>
          ) : (
            <PierreHighlightSkeleton filePath={filePath} testId="pierre-file-highlight-skeleton" />
          )}
        </div>
      </div>
    </div>
  );
});

// ─── Component ─────────────────────────────────────────────────────────────────

export const PierreDiffViewer = memo(function PierreDiffViewer({
  patch,
  filePath,
  diffStyle = "split",
  diffIndicators = "bars",
  lineOverflow = "wrap",
  hunkSeparators = "line-info",
  heightMode = "scroll",
  enableLineSelection = false,
  enableGutterUtility = false,
  enableHunkReset = false,
  isHunkResetDisabled = false,
  onResetHunk,
  selectedLines,
  onLineSelectionEnd,
  lineAnnotations = [],
  renderAnnotation,
  className,
}: PierreDiffViewerProps): ReactElement {
  const { theme } = useTheme();
  const isSelectionControlled = selectedLines !== undefined;
  const shouldMirrorSelectionChanges =
    isSelectionControlled &&
    onLineSelectionEnd != null &&
    (enableLineSelection || enableGutterUtility);
  const [transientSelectedLines, setTransientSelectedLines] = useState<
    SelectedLineRange | null | undefined
  >(undefined);
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
            setTransientSelectedLines(undefined);
            onLineSelectionEnd(buildPierreDiffSelection(fileDiff, range));
          }
        : undefined,
    [fileDiff, onLineSelectionEnd],
  );
  const handleLineSelectionChange = useMemo(
    () =>
      shouldMirrorSelectionChanges
        ? (range: SelectedLineRange | null) => {
            setTransientSelectedLines(range);
          }
        : undefined,
    [shouldMirrorSelectionChanges],
  );
  const handleGutterUtilityClick = useMemo(
    () =>
      enableGutterUtility && handleLineSelectionEnd
        ? (range: SelectedLineRange) => {
            handleLineSelectionEnd(range);
          }
        : undefined,
    [enableGutterUtility, handleLineSelectionEnd],
  );
  const options = useMemo(
    () => ({
      theme: DIFF_THEME,
      themeType: theme,
      diffStyle,
      diffIndicators,
      hunkSeparators,
      lineDiffType,
      overflow: lineOverflow,
      disableFileHeader: true,
      tokenizeMaxLength: PIERRE_HIGHLIGHT_LINE_LIMIT,
      enableLineSelection,
      enableGutterUtility: handleGutterUtilityClick != null,
      ...(handleLineSelectionChange
        ? {
            onLineSelectionStart: handleLineSelectionChange,
            onLineSelectionChange: handleLineSelectionChange,
          }
        : {}),
      ...(handleLineSelectionEnd ? { onLineSelectionEnd: handleLineSelectionEnd } : {}),
      ...(handleGutterUtilityClick ? { onGutterUtilityClick: handleGutterUtilityClick } : {}),
      ...(enableHunkReset ? { unsafeCSS: HUNK_RESET_FLOATING_CSS } : {}),
    }),
    [
      diffStyle,
      diffIndicators,
      enableHunkReset,
      enableLineSelection,
      handleGutterUtilityClick,
      handleLineSelectionChange,
      handleLineSelectionEnd,
      hunkSeparators,
      lineOverflow,
      lineDiffType,
      theme,
    ],
  );
  const renderedSelectedLines =
    transientSelectedLines !== undefined ? transientSelectedLines : selectedLines;
  const selectedLinesProps =
    renderedSelectedLines !== undefined ? { selectedLines: renderedSelectedLines } : {};
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
            <div
              className={HUNK_RESET_ANNOTATION_CLASS_NAME}
              {...{ [HUNK_RESET_ANNOTATION_MARKER_ATTRIBUTE]: "true" }}
            >
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
    content = <pre className={getRawDiffFallbackClassName(lineOverflow)}>{fallbackPatch}</pre>;
  } else {
    content = (
      <PierreReactFileDiff
        fileDiff={fileDiff}
        {...selectedLinesProps}
        options={options}
        lineAnnotations={mergedLineAnnotations}
        renderAnnotation={handleRenderAnnotation}
      />
    );
  }

  return (
    <div className={cn("min-w-0", className)} style={DIFF_WRAPPER_STYLE}>
      <div className={getPierreViewerContainerClassName(heightMode)}>{content}</div>
    </div>
  );
});

export const PierrePreloadedDiffViewer = memo(function PierrePreloadedDiffViewer(
  props: PierreDiffViewerProps,
): ReactElement {
  const { className, ...viewerProps } = props;
  const workerPool = useWorkerPool();
  const { fileDiff } = useMemo(
    () => getRenderableFileDiff(props.patch, props.filePath),
    [props.filePath, props.patch],
  );
  const fileDiffCacheKey = fileDiff?.cacheKey ?? null;
  const diffLineCount =
    fileDiff == null ? 0 : Math.max(fileDiff.additionLines.length, fileDiff.deletionLines.length);
  const requiresHighlight =
    fileDiff != null &&
    diffLineCount > 0 &&
    fileDiff.lang !== "text" &&
    diffLineCount <= PIERRE_HIGHLIGHT_LINE_LIMIT;
  const highlightStateBeforeSubscription = getPierreDiffHighlightState(
    workerPool,
    fileDiff,
    requiresHighlight,
    false,
  );
  const highlightTarget = useMemo<PierreHighlightTarget | null>(
    () =>
      fileDiff == null || fileDiffCacheKey == null
        ? null
        : { kind: "diff", fileDiff, taskKey: fileDiffCacheKey },
    [fileDiff, fileDiffCacheKey],
  );
  const didHighlightFail = usePierreHighlightTaskFailure({
    target: highlightTarget,
    workerPool,
    shouldStart: highlightStateBeforeSubscription === "pending",
  });
  const shouldSubscribeToHighlightCache =
    highlightStateBeforeSubscription === "pending" && !didHighlightFail;
  const subscribeToHighlightCache = useCallback(
    (onStoreChange: () => void) => {
      if (!shouldSubscribeToHighlightCache || workerPool == null) {
        return () => undefined;
      }
      return workerPool.subscribeToStatChanges(onStoreChange);
    },
    [shouldSubscribeToHighlightCache, workerPool],
  );
  const getHighlightCacheSnapshot = useCallback(
    () => getPierreDiffHighlightState(workerPool, fileDiff, requiresHighlight, didHighlightFail),
    [didHighlightFail, fileDiff, requiresHighlight, workerPool],
  );
  const highlightState = useSyncExternalStore(
    subscribeToHighlightCache,
    getHighlightCacheSnapshot,
    () => (requiresHighlight ? "pending" : "ready"),
  );
  const isHighlightReady = highlightState === "ready";

  if (highlightState === "unavailable") {
    return (
      <div className={cn("min-w-0", className)} style={DIFF_WRAPPER_STYLE}>
        <div
          className="px-3 py-4 text-sm text-destructive"
          role="alert"
        >{`Syntax highlighting ${didHighlightFail ? "failed" : "is unavailable"} for ${props.filePath}. Reload the session to try again.`}</div>
      </div>
    );
  }

  return (
    <div className={cn("grid min-w-0", className)}>
      {isHighlightReady ? (
        <div className="col-start-1 row-start-1 min-w-0">
          <PierreDiffViewer key={fileDiffCacheKey} {...viewerProps} />
        </div>
      ) : (
        <PierreHighlightSkeleton
          filePath={props.filePath}
          testId="pierre-diff-highlight-skeleton"
        />
      )}
    </div>
  );
});
