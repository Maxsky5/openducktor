/**
 * Diff rows for a virtualized list, in the desktop Pierre diff style: one line number column
 * with a change bar, washed changed lines, washed changed words, and "N unmodified lines" bars
 * between hunks. Build rows with `buildDiffRows(diff)` or `buildFileDiffRows(diff, path)` of
 * `diff-row-model.ts`, then render `DiffRowView` rows. Line rows report presses through
 * `onLinePress` and `onLineLongPress`, so a comment view can select a line or a range.
 */
import { memo, type ReactElement, useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { HighlightedLine } from "@/rich-content/code/highlight";
import { Touchable } from "@/ui/touchable";
import {
  DEFAULT_NUMBER_DIGITS,
  type DiffFileRow,
  type DiffHunkRow,
  type DiffLineRow,
  type DiffNoteRow,
  type DiffRow,
} from "./diff-row-model";
import { CODE_FONT_SIZE, CODE_LINE_HEIGHT, codeCharWidth, PIERRE_COLORS } from "./pierre-colors";
import { PierreCodeTokens } from "./pierre-code-tokens";

export type DiffRowViewProps = {
  row: DiffRow;
  /** True when the line is part of the comment selection. */
  selected?: boolean | undefined;
  /** The syntax tokens of a line row. Without them, the line shows as plain text. */
  tokens?: HighlightedLine | null | undefined;
  /** The digits of the largest line number of the file, so every row has one gutter width. */
  numberDigits?: number | undefined;
  onLinePress?: ((row: DiffLineRow) => void) | undefined;
  onLineLongPress?: ((row: DiffLineRow) => void) | undefined;
  /**
   * False keeps each line on one row, for a diff that scrolls sideways. Put all rows in one
   * horizontal `ScrollView` then, so the lines scroll together. Long lines wrap by default.
   */
  wrap?: boolean | undefined;
};

export const DiffRowView = memo(function DiffRowView({
  row,
  selected = false,
  tokens = null,
  numberDigits = DEFAULT_NUMBER_DIGITS,
  onLinePress,
  onLineLongPress,
  wrap = true,
}: DiffRowViewProps): ReactElement {
  switch (row.kind) {
    case "file":
      return <FileRow row={row} />;
    case "hunk":
      return <HunkSeparator row={row} />;
    case "note":
      return <NoteRow row={row} numberDigits={numberDigits} />;
    case "line":
      return (
        <LineRow
          row={row}
          selected={selected}
          tokens={tokens}
          numberDigits={numberDigits}
          wrap={wrap}
          onPress={onLinePress}
          onLongPress={onLineLongPress}
        />
      );
  }
});

const STATUS_LABELS = {
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  renamed: "Renamed",
} as const;

function FileRow({ row }: { row: DiffFileRow }): ReactElement {
  const moved = row.status === "renamed" && row.oldPath !== null && row.oldPath !== row.path;
  return (
    <View
      style={styles.file}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${STATUS_LABELS[row.status]} file ${row.path}, ${row.additions} added lines, ${row.deletions} deleted lines`}
    >
      <Text style={styles.filePath} numberOfLines={2} ellipsizeMode="middle">
        {moved ? `${row.oldPath} → ${row.path}` : row.path}
      </Text>
      <Text style={styles.fileMeta}>
        {STATUS_LABELS[row.status]}
        {row.additions > 0 ? <Text style={styles.added}>{`  +${row.additions}`}</Text> : null}
        {row.deletions > 0 ? <Text style={styles.deleted}>{`  -${row.deletions}`}</Text> : null}
      </Text>
    </View>
  );
}

const unmodifiedLabel = (count: number): string =>
  `${count.toLocaleString("en-US")} unmodified ${count === 1 ? "line" : "lines"}`;

/**
 * The bar between hunks. It names the unchanged lines that the diff skips, as desktop does. A hunk
 * right after the previous one, or at the top of the file, shows only a gap.
 */
function HunkSeparator({ row }: { row: DiffHunkRow }): ReactElement {
  if (row.hiddenBefore === 0) {
    return <View style={row.hunkIndex === 0 ? styles.topGap : styles.hunkGap} />;
  }
  const label = row.hiddenBefore === null ? row.header : unmodifiedLabel(row.hiddenBefore);
  return (
    <View
      style={styles.separatorRow}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <View style={styles.separator}>
        <Text style={styles.separatorText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/**
 * The gutter style of a row. A recycled row keeps it while the digits stay, so a scroll does not
 * build the style again for each line.
 */
const useGutter = (digits: number) => useMemo(() => styles.gutter(digits), [digits]);

function NoteRow({ row, numberDigits }: { row: DiffNoteRow; numberDigits: number }): ReactElement {
  // Git writes `\ No newline at end of file`; desktop shows the words without the backslash.
  const text = row.text.startsWith("\\ ") ? row.text.slice(2) : row.text;
  const gutter = useGutter(numberDigits);
  return (
    <View style={styles.note}>
      <View style={gutter} />
      <Text style={[styles.code, styles.noteText]}>{text}</Text>
    </View>
  );
}

const LINE_LABELS = { add: "Added line", delete: "Deleted line", context: "Line" } as const;

function LineRow({
  row,
  selected,
  tokens,
  numberDigits,
  wrap,
  onPress,
  onLongPress,
}: {
  row: DiffLineRow;
  selected: boolean;
  tokens: HighlightedLine | null;
  numberDigits: number;
  wrap: boolean;
  onPress: ((row: DiffLineRow) => void) | undefined;
  onLongPress: ((row: DiffLineRow) => void) | undefined;
}): ReactElement {
  const change = changeStyles(row.change);
  const gutter = useGutter(numberDigits);
  const wash = [change.wash, selected && styles.lineSelected];
  const press = useCallback(() => onPress?.(row), [onPress, row]);
  const longPress = useCallback(() => onLongPress?.(row), [onLongPress, row]);
  // A line without syntax tokens still shows its changed words.
  const shownTokens = useMemo<HighlightedLine | null>(
    () => tokens ?? (row.emphasis === null ? null : [{ text: row.text, tone: "plain" }]),
    [row.emphasis, row.text, tokens],
  );
  const lineNumber = row.change === "delete" ? row.oldLine : row.newLine;
  const label = `${LINE_LABELS[row.change]}${lineNumber === null ? "" : ` ${lineNumber}`}: ${row.text}`;
  const content = (
    <>
      <View style={[gutter, change.gutter, selected && styles.gutterSelected]}>
        {change.bar ? <View style={change.bar} /> : null}
        <Text style={[styles.code, change.number, selected && styles.numberSelected]}>
          {lineNumber ?? ""}
        </Text>
      </View>
      <Text style={[styles.code, wrap ? styles.textWrap : styles.textNoWrap]}>
        {shownTokens === null ? (
          row.text
        ) : (
          <PierreCodeTokens
            tokens={shownTokens}
            emphasis={row.emphasis}
            change={row.change === "delete" ? "delete" : "add"}
          />
        )}
      </Text>
    </>
  );
  if (onPress === undefined && onLongPress === undefined) {
    return (
      <View
        style={[wash, styles.line]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
      >
        {content}
      </View>
    );
  }
  return (
    <Touchable
      feedback="highlight"
      onPress={onPress === undefined ? undefined : press}
      onLongPress={onLongPress === undefined ? undefined : longPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      // The change wash stays on the touch area, under the press highlight.
      containerStyle={wash}
      style={styles.line}
    >
      {content}
    </Touchable>
  );
}

/** The bar at the start of a changed line: solid for an added line, dashed for a removed line. */
const BAR_WIDTH = 4;
/** The gutter space before and after the line number. */
const GUTTER_START = 12;
const GUTTER_END = 8;

const styles = StyleSheet.create((theme, rt) => ({
  file: {
    gap: theme.space.xxs,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    backgroundColor: PIERRE_COLORS[theme.scheme].separator,
  },
  filePath: {
    fontFamily: theme.fonts.mono.medium,
    fontSize: theme.type.footnote.fontSize,
    lineHeight: theme.type.footnote.lineHeight,
    color: PIERRE_COLORS[theme.scheme].foreground,
  },
  fileMeta: { ...theme.type.caption1, color: PIERRE_COLORS[theme.scheme].lineNumber },
  added: { fontFamily: theme.fonts.mono.regular, color: PIERRE_COLORS[theme.scheme].addition },
  deleted: { fontFamily: theme.fonts.mono.regular, color: PIERRE_COLORS[theme.scheme].deletion },
  topGap: { height: theme.space.sm, backgroundColor: PIERRE_COLORS[theme.scheme].background },
  hunkGap: { height: theme.space.xs, backgroundColor: PIERRE_COLORS[theme.scheme].background },
  separatorRow: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.sm,
    backgroundColor: PIERRE_COLORS[theme.scheme].background,
  },
  separator: {
    height: 32,
    justifyContent: "center",
    paddingHorizontal: theme.space.sm,
    borderRadius: 6,
    borderCurve: "continuous",
    backgroundColor: PIERRE_COLORS[theme.scheme].separator,
  },
  separatorText: {
    ...theme.type.footnote,
    fontSize: 13,
    color: PIERRE_COLORS[theme.scheme].lineNumber,
  },
  note: { flexDirection: "row", backgroundColor: PIERRE_COLORS[theme.scheme].background },
  noteText: {
    flex: 1,
    color: PIERRE_COLORS[theme.scheme].lineNumber,
    paddingRight: theme.space.md,
  },
  // Line rows use static styles: `useVariants` copies and parses the whole sheet for each row.
  lineAdd: { backgroundColor: PIERRE_COLORS[theme.scheme].additionLine },
  lineDelete: { backgroundColor: PIERRE_COLORS[theme.scheme].deletionLine },
  lineContext: { backgroundColor: PIERRE_COLORS[theme.scheme].background },
  lineSelected: { backgroundColor: PIERRE_COLORS[theme.scheme].selectionLine },
  line: { flexDirection: "row", minHeight: CODE_LINE_HEIGHT },
  gutter: (digits: number) => ({
    width: Math.ceil(digits * codeCharWidth(rt.fontScale)) + GUTTER_START + GUTTER_END,
    paddingLeft: GUTTER_START,
    paddingRight: GUTTER_END,
  }),
  gutterAdd: { backgroundColor: PIERRE_COLORS[theme.scheme].additionGutter },
  gutterDelete: { backgroundColor: PIERRE_COLORS[theme.scheme].deletionGutter },
  gutterSelected: { backgroundColor: PIERRE_COLORS[theme.scheme].selectionGutter },
  barAdd: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: BAR_WIDTH,
    backgroundColor: PIERRE_COLORS[theme.scheme].addition,
  },
  // Desktop stripes the bar of a removed line, so the change shows without color too.
  barDelete: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: BAR_WIDTH,
    borderWidth: BAR_WIDTH / 2,
    borderStyle: "dashed",
    borderColor: PIERRE_COLORS[theme.scheme].deletion,
  },
  code: {
    fontFamily: theme.fonts.mono.regular,
    fontSize: CODE_FONT_SIZE,
    lineHeight: CODE_LINE_HEIGHT,
    color: PIERRE_COLORS[theme.scheme].foreground,
  },
  numberAdd: {
    textAlign: "right",
    fontVariant: ["tabular-nums"],
    color: PIERRE_COLORS[theme.scheme].addition,
  },
  numberDelete: {
    textAlign: "right",
    fontVariant: ["tabular-nums"],
    color: PIERRE_COLORS[theme.scheme].deletion,
  },
  numberContext: {
    textAlign: "right",
    fontVariant: ["tabular-nums"],
    color: PIERRE_COLORS[theme.scheme].lineNumber,
  },
  numberSelected: { color: PIERRE_COLORS[theme.scheme].selectionNumber },
  textWrap: { flex: 1, paddingLeft: theme.space.sm, paddingRight: theme.space.md },
  textNoWrap: { flexShrink: 0, paddingLeft: theme.space.sm, paddingRight: theme.space.md },
}));

/** The static styles of the change of a line row. A context line has no gutter wash and no bar. */
const changeStyles = (change: DiffLineRow["change"]) => {
  switch (change) {
    case "add":
      return {
        wash: styles.lineAdd,
        gutter: styles.gutterAdd,
        bar: styles.barAdd,
        number: styles.numberAdd,
      };
    case "delete":
      return {
        wash: styles.lineDelete,
        gutter: styles.gutterDelete,
        bar: styles.barDelete,
        number: styles.numberDelete,
      };
    case "context":
      return { wash: styles.lineContext, gutter: null, bar: null, number: styles.numberContext };
  }
};
