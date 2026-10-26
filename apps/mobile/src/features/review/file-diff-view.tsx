import type { GitFileDiff } from "@openducktor/contracts";
import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { PIERRE_COLORS } from "@/rich-content/diff/pierre-colors";
import { useAppTheme } from "@/theme/app-theme-context";
import { KeyboardInsetView } from "@/ui/keyboard-inset-view";
import { useScreenEndSpace } from "@/ui/screen";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import {
  type ChangedFileGroup,
  changedFileKey,
  FILE_STATUS_LABELS,
  groupDiffScope,
} from "./changes-model";
import { buildDiffBody, type DiffBodyRow, diffBodyRowType } from "./diff-body-model";
import { type DiffBodyContext, DiffBodyRowView } from "./diff-body-rows";
import { DiffCommentBar, useDiffCommentFlow } from "./diff-comment-flow";
import type { CommentFile } from "./diff-comment-flow-model";
import { FileStatusIcon } from "./file-status-badge";
import { LineCounts } from "./line-counts";
import { prepareFileDiff } from "./prepared-diff";
import { useOwnerDiffComments } from "./use-diff-comments";
import { useWarmDiffSyntax } from "./use-warm-diff-syntax";

/**
 * The whole unified File Diff of one changed file, in the desktop diff style, with Inline Diff
 * Comments. Tap a line to select it, tap another line of the same side to extend the range, then
 * write the comment. Every line is a list row, so a diff of thousands of lines scrolls smoothly.
 */
export function FileDiffView({
  owner,
  diff,
  group,
  refreshError,
}: {
  owner: WorkOwner;
  diff: GitFileDiff;
  group: ChangedFileGroup;
  /** Why the last Git read failed. The view still shows the last loaded diff. */
  refreshError: string | null;
}): ReactElement {
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  const diffScope = groupDiffScope(group);
  const status = group === "conflicted" ? "conflicted" : diff.type;
  const prepared = prepareFileDiff(diff, group);
  const fileKey = changedFileKey(group, diff.file);
  const { commentsByFile, commentsById, addComment, updateComment, removeComment } =
    useOwnerDiffComments(owner.commentOwner, owner.git.diffData);
  const comments = commentsByFile.get(fileKey) ?? NO_COMMENTS;
  const file = useMemo<CommentFile>(
    () => ({ fileKey, path: diff.file, diffScope }),
    [diff.file, diffScope, fileKey],
  );
  const rows = useMemo(
    () =>
      buildDiffBody({
        fileKey,
        path: diff.file,
        prepared,
        comments,
        rowLimit: null,
        withEnd: false,
      }),
    [comments, diff.file, fileKey, prepared],
  );
  const warmed = useMemo(() => [prepared], [prepared]);
  useWarmDiffSyntax(warmed);
  const rowsOf = useCallback(() => prepared.rows, [prepared]);
  const flow = useDiffCommentFlow({ rowsOf, addComment, updateComment, removeComment });
  const context = useMemo<DiffBodyContext>(
    () => ({
      preparedOf: () => prepared,
      fileOf: () => file,
      commentOf: (commentId) => commentsById.get(commentId),
      selection: flow.selection,
      onLinePress: flow.selectLine,
      onEditComment: flow.editComment,
      onRemoveComment: flow.removeComment,
      onOpenFullDiff: NO_OP,
    }),
    [
      commentsById,
      file,
      flow.editComment,
      flow.removeComment,
      flow.selectLine,
      flow.selection,
      prepared,
    ],
  );
  const renderItem = useCallback<ListRenderItem<DiffBodyRow>>(
    ({ item }) => <DiffBodyRowView row={item} context={context} />,
    [context],
  );

  const header = (
    <View style={styles.header}>
      {refreshError ? (
        <View style={styles.notice}>
          <Callout
            tone="destructive"
            title="Refresh failed"
            message={`${refreshError} The view shows the last loaded diff.`}
          />
        </View>
      ) : null}
      <View
        style={styles.fileLine}
        accessible
        accessibilityLabel={`${diff.file}, ${FILE_STATUS_LABELS[status]}`}
      >
        <FileStatusIcon changeType={diff.type} />
        <Text variant="subhead" weight="medium" style={styles.status}>
          {FILE_STATUS_LABELS[status]}
        </Text>
        <LineCounts additions={diff.additions} deletions={diff.deletions} />
      </View>
      {prepared.renamedFrom ? (
        <Text variant="footnote" selectable style={styles.muted}>
          {"Renamed from "}
          <Text variant="monoSmall" style={styles.muted}>
            {prepared.renamedFrom}
          </Text>
        </Text>
      ) : null}
    </View>
  );

  return (
    <KeyboardInsetView style={styles.screen} barSafeArea>
      <View style={styles.page}>
        <FlashList
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyOf}
          getItemType={diffBodyRowType}
          extraData={renderItem}
          ListHeaderComponent={header}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
          keyboardShouldPersistTaps="handled"
          // The safe area sets this end padding. It changes only on rotation and moves no row.
          // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
          contentContainerStyle={{ paddingBottom: endSpace }}
        />
      </View>
      <DiffCommentBar flow={flow} recipientLabel={owner.recipientLabel} />
    </KeyboardInsetView>
  );
}

const NO_OP = (): void => {};
const NO_COMMENTS: InlineCommentDraft[] = [];
const keyOf = (row: DiffBodyRow): string => row.key;

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  page: { flex: 1, backgroundColor: PIERRE_COLORS[theme.scheme].background },
  header: {
    gap: theme.space.xs,
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.md,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.colors.diffDivider,
    backgroundColor: theme.colors.background,
  },
  notice: { paddingBottom: theme.space.sm },
  fileLine: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  status: { flex: 1, color: theme.desktop.foreground },
  muted: { color: theme.desktop.mutedForeground },
}));
