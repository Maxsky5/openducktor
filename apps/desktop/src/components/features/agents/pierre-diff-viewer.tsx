import { PatchDiff } from "@pierre/diffs/react";
import { memo, type ReactElement } from "react";
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

  return (
    <div
      className={className}
      style={
        {
          "--diffs-font-size": "12px",
          "--diffs-line-height": "1.5",
          "--diffs-tab-size": 2,
        } as React.CSSProperties
      }
    >
      <PatchDiff
        patch={patch}
        options={{
          theme: { dark: "pierre-dark", light: "pierre-light" },
          themeType: theme,
          diffStyle,
          diffIndicators: "bars",
          hunkSeparators: "line-info",
          lineDiffType: diffStyle === "split" ? "word-alt" : "none",
          overflow: "wrap",
          disableFileHeader: true,
          enableLineSelection,
        }}
      />
    </div>
  );
});
