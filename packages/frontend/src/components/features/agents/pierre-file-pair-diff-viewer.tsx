import { getFiletypeFromFileName } from "@pierre/diffs";
import { MultiFileDiff } from "@pierre/diffs/react";
import { memo, useMemo, type ComponentProps } from "react";
import { useTheme } from "@/components/layout/theme-provider";
import { PIERRE_DIFF_THEME, PIERRE_HIGHLIGHT_LINE_LIMIT } from "@/lib/diff/pierre-config";
import { cn } from "@/lib/utils";
import type { PierreDiffViewer } from "./pierre-diff-viewer";

type Props = Pick<
  ComponentProps<typeof PierreDiffViewer>,
  "filePath" | "diffStyle" | "diffIndicators" | "heightMode" | "lineOverflow" | "hunkSeparators"
> & { oldContent: string; newContent: string };

export const PierreFilePairDiffViewer = memo(function PierreFilePairDiffViewer({
  filePath,
  oldContent,
  newContent,
  diffStyle = "split",
  diffIndicators = "bars",
  heightMode = "scroll",
  lineOverflow = "wrap",
  hunkSeparators = "line-info",
}: Props) {
  const { theme } = useTheme();
  const oldFile = useMemo(
    () => ({ name: filePath, contents: oldContent, lang: getFiletypeFromFileName(filePath) }),
    [filePath, oldContent],
  );
  const newFile = useMemo(
    () => ({ name: filePath, contents: newContent, lang: getFiletypeFromFileName(filePath) }),
    [filePath, newContent],
  );
  const options = useMemo(
    () => ({
      theme: PIERRE_DIFF_THEME,
      themeType: theme,
      diffStyle,
      diffIndicators,
      overflow: lineOverflow,
      hunkSeparators,
      disableFileHeader: true,
      tokenizeMaxLength: PIERRE_HIGHLIGHT_LINE_LIMIT,
    }),
    [theme, diffStyle, diffIndicators, lineOverflow, hunkSeparators],
  );
  return (
    <div
      className={cn(
        "min-w-0 [--diffs-font-size:12px] [--diffs-line-height:1.5] [--diffs-tab-size:2]",
        heightMode === "scroll" && "max-h-[min(50vh,32rem)] overflow-auto",
      )}
    >
      <MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} />
    </div>
  );
});
