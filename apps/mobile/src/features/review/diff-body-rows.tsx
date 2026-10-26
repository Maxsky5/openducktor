import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { memo, type ReactElement, useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DiffLineRow } from "@/rich-content/diff/diff-row-model";
import { DiffRowView } from "@/rich-content/diff/diff-rows";
import { PIERRE_COLORS } from "@/rich-content/diff/pierre-colors";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import type { DiffBodyRow } from "./diff-body-model";
import { type CommentFile, type FileLineSelection, isRowSelected } from "./diff-comment-flow-model";
import { DiffCommentView } from "./diff-comment-view";
import type { PreparedFileDiff } from "./prepared-diff";

/** What the rows of the file diff bodies in one list share. */
export type DiffBodyContext = {
  preparedOf: (fileKey: string) => PreparedFileDiff | null;
  /** The comment file of a diff body. Return one object for each file, so rows stay memoized. */
  fileOf: (fileKey: string) => CommentFile | null;
  commentOf: (commentId: string) => InlineCommentDraft | undefined;
  selection: FileLineSelection | null;
  onLinePress: (file: CommentFile, row: DiffLineRow) => void;
  onEditComment: (comment: InlineCommentDraft) => void;
  onRemoveComment: (comment: InlineCommentDraft) => void;
  /** Opens the File Diff screen of a file whose inline diff stops early. */
  onOpenFullDiff: (fileKey: string) => void;
};

/** One row of a file diff body. */
export function DiffBodyRowView({
  row,
  context,
}: {
  row: DiffBodyRow;
  context: DiffBodyContext;
}): ReactElement | null {
  switch (row.kind) {
    case "diff": {
      const prepared = context.preparedOf(row.fileKey);
      const file = context.fileOf(row.fileKey);
      if (!prepared || !file) return null;
      const line = row.row.kind === "line" ? row.row : null;
      return (
        <DiffBodyLine
          row={row.row}
          file={file}
          selected={line !== null && isRowSelected(context.selection, row.fileKey, line)}
          prepared={prepared}
          onLinePress={context.onLinePress}
        />
      );
    }
    case "comment": {
      const comment = context.commentOf(row.commentId);
      return comment ? (
        <DiffCommentView
          comment={comment}
          onEdit={context.onEditComment}
          onRemove={context.onRemoveComment}
        />
      ) : null;
    }
    case "unplaced":
      return (
        <View style={styles.page}>
          <Text variant="caption1" style={styles.unplaced}>
            The lines of these comments changed. They stay pending, and Send includes their saved
            code context.
          </Text>
        </View>
      );
    case "more":
      return (
        <MoreLines
          fileKey={row.fileKey}
          hiddenLines={row.hiddenLines}
          onOpen={context.onOpenFullDiff}
        />
      );
    case "no-text":
      return (
        <View style={styles.page}>
          <Text variant="footnote" style={styles.noText}>
            {row.message}
          </Text>
        </View>
      );
    case "end":
      return <View style={styles.end} />;
  }
}

const DiffBodyLine = memo(function DiffBodyLine({
  row,
  file,
  selected,
  prepared,
  onLinePress,
}: {
  row: Extract<DiffBodyRow, { kind: "diff" }>["row"];
  file: CommentFile;
  selected: boolean;
  prepared: PreparedFileDiff;
  onLinePress: (file: CommentFile, row: DiffLineRow) => void;
}): ReactElement {
  const press = useCallback((line: DiffLineRow) => onLinePress(file, line), [file, onLinePress]);
  return (
    <DiffRowView
      row={row}
      selected={selected}
      tokens={row.kind === "line" ? (prepared.syntax?.tokensFor(row) ?? null) : null}
      numberDigits={prepared.numberDigits}
      onLinePress={press}
    />
  );
});

/** The end of an inline diff that stops early, with the link to the whole diff. */
const MoreLines = memo(function MoreLines({
  fileKey,
  hiddenLines,
  onOpen,
}: {
  fileKey: string;
  hiddenLines: number;
  onOpen: (fileKey: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  const label = `${hiddenLines.toLocaleString("en-US")} more ${hiddenLines === 1 ? "line" : "lines"}`;
  return (
    <View style={styles.morePage}>
      <Touchable
        feedback="highlight"
        onPress={() => onOpen(fileKey)}
        radius={6}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Open the full diff`}
        style={styles.more}
      >
        <Text variant="footnote" style={styles.moreCount}>
          {label}
        </Text>
        <Text variant="footnote" weight="semibold" style={styles.moreAction}>
          Open full diff
        </Text>
        <Icon name="maximize-2" size={13} colorValue={theme.desktop.foreground} />
      </Touchable>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  page: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    backgroundColor: PIERRE_COLORS[theme.scheme].background,
  },
  unplaced: { color: theme.desktop.mutedForeground },
  noText: { fontStyle: "italic", color: theme.desktop.mutedForeground },
  morePage: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.sm,
    backgroundColor: PIERRE_COLORS[theme.scheme].background,
  },
  more: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
    backgroundColor: PIERRE_COLORS[theme.scheme].separator,
  },
  moreCount: { flex: 1, color: PIERRE_COLORS[theme.scheme].lineNumber },
  moreAction: { color: theme.desktop.foreground },
  end: {
    height: theme.space.sm,
    backgroundColor: PIERRE_COLORS[theme.scheme].background,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.colors.diffDivider,
  },
}));
