import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import type { DiffScope } from "@openducktor/frontend-core/git/contracts";
import { gitPanelTabCounts } from "@openducktor/frontend-core/git/model/git-panel-header";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactElement, useCallback, useMemo, useReducer, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { toWorkOwnerParams } from "@/features/work-owner/work-owner-params";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { useCommandGate } from "@/host-session/active-session-context";
import { routes, sessionParams } from "@/navigation/routes";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import { useAppTheme } from "@/theme/app-theme-context";
import { haptics } from "@/ui/haptics";
import { IconButton } from "@/ui/icon-button";
import { KeyboardInsetView } from "@/ui/keyboard-inset-view";
import { KEEP_TOP_VISIBLE } from "@/ui/list-position";
import { Text } from "@/ui/text";
import { ListRefreshControl } from "@/ui/refresh-control";
import { useScreenEndSpace } from "@/ui/screen";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import { BranchSummary } from "./branch-summary";
import { ComparisonBranchPicker } from "./comparison-branch-picker";
import { FileListHeader, HeaderNotice, PendingComments, ScopeTabs } from "./changes-header";
import { buildChangesRows, type ChangesRow, changesRowType } from "./changes-list-model";
import {
  buildChangesItems,
  type ChangedFileItem,
  type ChangesListItem,
  changedFileDiffs,
  changesNotices,
  changesScopeStatus,
  changesTotals,
  type CollapsibleGroup,
  groupDiffScope,
  parseChangedFileKey,
} from "./changes-model";
import {
  type ChangedFileAction,
  ChangedFileRow,
  DirectoryRow,
  GroupEmpty,
  GroupHeader,
} from "./changes-rows";
import { ChangesState } from "./changes-state";
import {
  type ChangesFocus,
  changesViewReducer,
  type ChangesViewState,
  createChangesViewState,
  type FileListViewMode,
  readChangesFocus,
} from "./changes-view-state";
import { activeGitConflict } from "./conflict-model";
import { ConflictPanel } from "./conflict-panel";
import { buildDiffBody, INLINE_DIFF_ROW_LIMIT } from "./diff-body-model";
import { type DiffBodyContext, DiffBodyRowView } from "./diff-body-rows";
import { DiffCommentBar, useDiffCommentFlow } from "./diff-comment-flow";
import type { CommentFile } from "./diff-comment-flow-model";
import { prepareFileDiff, type PreparedFileDiff } from "./prepared-diff";
import { useOwnerDiffComments, usePendingCommentCount } from "./use-diff-comments";
import { useGitConflictActions } from "./use-git-conflict-actions";
import { useWarmDiffSyntax } from "./use-warm-diff-syntax";

/** The list view that the last Changes view used, so the next one opens the same way. */
let preferredViewMode: FileListViewMode = "tree";

/**
 * The Changes view of a task worktree or a chat directory, as the desktop Git panel: the branch
 * card, the scope tabs, and the changed files, each with its diff under its row. It has no Git
 * write actions.
 */
export function ChangesScreen(): ReactElement {
  const { scope, file } = useLocalSearchParams<{ scope?: string; file?: string }>();
  const focus = useMemo(() => readChangesFocus(scope, file), [file, scope]);
  return (
    <WorkOwnerScreen title="Changes" diffs>
      {(owner) => <ChangesContent owner={owner} focus={focus} />}
    </WorkOwnerScreen>
  );
}

const NO_COMMENTS: InlineCommentDraft[] = [];
const NO_ROWS: ChangesRow[] = [];

/**
 * The diffs of the expanded files, and their comment files. Parsing reuses the rows of an
 * unchanged diff text, and Git reads keep the comment files, so diff rows stay memoized.
 */
const useExpandedFileDiffs = (
  diffData: WorkOwner["git"]["diffData"],
  view: ChangesViewState,
  items: readonly ChangesListItem[],
) => {
  const diffs = useMemo(() => changedFileDiffs(diffData, view.scope), [diffData, view.scope]);
  const prepared = useMemo(() => {
    const byKey = new Map<string, PreparedFileDiff>();
    for (const item of items) {
      if (item.kind !== "file" || !view.expandedFiles.has(item.key)) continue;
      const diff = diffs.get(item.key);
      if (diff) byKey.set(item.key, prepareFileDiff(diff, item.group));
    }
    return byKey;
  }, [diffs, items, view.expandedFiles]);
  const preparedList = useMemo(() => [...prepared.values()], [prepared]);
  useWarmDiffSyntax(preparedList);
  const commentFiles = useMemo(() => {
    const files = new Map<string, CommentFile>();
    for (const fileKey of view.expandedFiles) {
      const { group, path } = parseChangedFileKey(fileKey);
      files.set(fileKey, { fileKey, path, diffScope: groupDiffScope(group) });
    }
    return files;
  }, [view.expandedFiles]);
  return { prepared, commentFiles };
};

function ChangesContent({
  owner,
  focus,
}: {
  owner: WorkOwner;
  /** The file that the view opens on, such as the file of a pending comment. */
  focus: ChangesFocus | null;
}): ReactElement {
  const router = useRouter();
  const gate = useCommandGate();
  const { copyText } = useClipboardCopy();
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  const [view, dispatch] = useReducer(changesViewReducer, focus, (initial) =>
    createChangesViewState(preferredViewMode, initial),
  );
  const {
    diffData,
    manualRefresh,
    currentBranch,
    contextMode,
    workingDirectoryUnavailableReason,
    comparisonChoice,
  } = owner.git;
  const [choosingTarget, setChoosingTarget] = useState(false);
  const items = useMemo(() => buildChangesItems(diffData, view.scope), [diffData, view.scope]);
  const totals = useMemo(() => changesTotals(items), [items]);
  const status = changesScopeStatus(diffData, view.scope, {
    fileCount: totals.fileCount,
    contextMode,
    directoryProblem: workingDirectoryUnavailableReason,
  });
  const notices = changesNotices(diffData, manualRefresh.refreshError, view.scope);
  const conflict = useMemo(() => activeGitConflict(diffData), [diffData]);
  const workspaceId = owner.workspace.workspaceId;
  const openSession = useCallback(
    (identity: Parameters<typeof sessionParams>[1]) =>
      router.push(routes.session(sessionParams(workspaceId, identity))),
    [router, workspaceId],
  );
  const conflictActions = useGitConflictActions({ owner, conflict, onOpenSession: openSession });
  const pendingComments = usePendingCommentCount(owner.commentOwner);
  const comments = useOwnerDiffComments(owner.commentOwner, diffData);
  const { commentsByFile, commentsById } = comments;
  const ownerParams = useMemo(() => toWorkOwnerParams(owner.ref), [owner.ref]);

  const { prepared, commentFiles } = useExpandedFileDiffs(diffData, view, items);

  const commentsOf = useCallback(
    (file: ChangedFileItem) => commentsByFile.get(file.key) ?? NO_COMMENTS,
    [commentsByFile],
  );
  const rows = useMemo(() => {
    if (status.kind !== "ready") return NO_ROWS;
    return buildChangesRows({
      items,
      viewMode: view.viewMode,
      expandedFiles: view.expandedFiles,
      collapsedGroups: view.collapsedGroups,
      closedDirectories: view.closedDirectories,
      diffBody: (file) => {
        const filePrepared = prepared.get(file.key);
        return filePrepared
          ? buildDiffBody({
              fileKey: file.key,
              path: file.path,
              prepared: filePrepared,
              comments: commentsOf(file),
              rowLimit: INLINE_DIFF_ROW_LIMIT,
              withEnd: true,
            })
          : [];
      },
    });
  }, [commentsOf, items, prepared, status.kind, view]);

  const rowsOf = useCallback((fileKey: string) => prepared.get(fileKey)?.rows ?? null, [prepared]);
  const flow = useDiffCommentFlow({
    rowsOf,
    addComment: comments.addComment,
    updateComment: comments.updateComment,
    removeComment: comments.removeComment,
  });

  const { hideDiff } = flow;
  const toggleFile = useCallback(
    (file: ChangedFileItem) => {
      haptics.selection();
      hideDiff(file.key);
      dispatch({ type: "file_toggled", fileKey: file.key });
    },
    [hideDiff],
  );
  const selectScope = useCallback(
    (scope: DiffScope) => {
      hideDiff(null);
      dispatch({ type: "scope_selected", scope });
    },
    [hideDiff],
  );
  const toggleGroup = useCallback(
    (group: CollapsibleGroup) => dispatch({ type: "group_toggled", group }),
    [],
  );
  const toggleDirectory = useCallback(
    (directoryKey: string) => dispatch({ type: "directory_toggled", directoryKey }),
    [],
  );
  const selectViewMode = useCallback((viewMode: FileListViewMode) => {
    preferredViewMode = viewMode;
    dispatch({ type: "view_mode_selected", viewMode });
  }, []);
  const fileAction = useCallback(
    (file: ChangedFileItem, action: ChangedFileAction) => {
      switch (action) {
        case "open-diff":
          router.push(routes.diff(ownerParams, file.path, file.group));
          return;
        case "view-file":
          router.push(routes.file(ownerParams, file.path));
          return;
        case "copy-path":
          void copyText(file.path, { copied: "Path copied", failed: "The path was not copied." });
      }
    },
    [copyText, ownerParams, router],
  );
  const openFullDiff = useCallback(
    (fileKey: string) => {
      const item = items.find((entry) => entry.kind === "file" && entry.key === fileKey);
      if (item?.kind === "file") router.push(routes.diff(ownerParams, item.path, item.group));
    },
    [items, ownerParams, router],
  );

  const refresh = useCallback(() => {
    void manualRefresh.refresh();
  }, [manualRefresh]);
  const headerRight = useCallback(
    () => (
      <IconButton
        icon="refresh"
        accessibilityLabel={manualRefresh.isRefreshing ? "Refreshing changes" : "Refresh changes"}
        onPress={refresh}
        command
        disabled={manualRefresh.isRefreshing}
      />
    ),
    [manualRefresh.isRefreshing, refresh],
  );
  const feedbackSession = owner.feedback.session;
  const sendFeedback = useCallback(() => {
    if (feedbackSession) router.push(routes.session(feedbackSession));
  }, [feedbackSession, router]);

  const bodyContext = useMemo<DiffBodyContext>(
    () => ({
      preparedOf: (fileKey) => prepared.get(fileKey) ?? null,
      fileOf: (fileKey) => commentFiles.get(fileKey) ?? null,
      commentOf: (commentId) => commentsById.get(commentId),
      selection: flow.selection,
      onLinePress: flow.selectLine,
      onEditComment: flow.editComment,
      onRemoveComment: flow.removeComment,
      onOpenFullDiff: openFullDiff,
    }),
    [
      commentFiles,
      commentsById,
      flow.editComment,
      flow.removeComment,
      flow.selectLine,
      flow.selection,
      openFullDiff,
      prepared,
    ],
  );
  const renderItem = useCallback<ListRenderItem<ChangesRow>>(
    ({ item }) => {
      switch (item.kind) {
        case "group":
          return <GroupHeader row={item} onToggle={toggleGroup} />;
        case "group-empty":
          return <GroupEmpty text={item.text} />;
        case "directory":
          return <DirectoryRow row={item} onToggle={toggleDirectory} />;
        case "file":
          return (
            <ChangedFileRow
              row={item}
              commentCount={commentsOf(item.file).length}
              onToggle={toggleFile}
              onAction={fileAction}
            />
          );
        default:
          return <DiffBodyRowView row={item} context={bodyContext} />;
      }
    },
    [bodyContext, commentsOf, fileAction, toggleDirectory, toggleFile, toggleGroup],
  );

  const header = (
    <View style={styles.header}>
      <BranchSummary
        diffData={diffData}
        currentBranch={currentBranch}
        onChooseTarget={comparisonChoice ? () => setChoosingTarget(true) : undefined}
        chooseSendsCommand={comparisonChoice?.command}
      />
      <View>
        {notices.map((notice) => (
          <HeaderNotice key={notice.key} notice={notice} />
        ))}
        {conflict ? (
          <ConflictPanel
            conflict={conflict}
            actions={conflictActions}
            recipientLabel={owner.recipientLabel}
          />
        ) : null}
      </View>
      {pendingComments > 0 ? (
        <PendingComments
          count={pendingComments}
          recipientLabel={owner.recipientLabel}
          blockedReason={owner.feedback.blockedReason}
          onRetry={owner.feedback.retry}
          canSend={feedbackSession !== null}
          onSend={sendFeedback}
        />
      ) : null}
      <View>
        <ScopeTabs scope={view.scope} counts={gitPanelTabCounts(diffData)} onSelect={selectScope} />
        {status.kind === "ready" ? (
          <FileListHeader
            totals={totals}
            viewMode={view.viewMode}
            onViewModeChange={selectViewMode}
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: "Changes", headerRight }} />
      <KeyboardInsetView style={styles.screen} barSafeArea>
        <FlashList
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyOf}
          getItemType={changesRowType}
          extraData={renderItem}
          maintainVisibleContentPosition={KEEP_TOP_VISIBLE}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          ListEmptyComponent={
            status.kind === "ready" ? null : (
              <ChangesState status={status} onRetry={gate.open ? refresh : undefined} />
            )
          }
          ListFooterComponent={
            status.kind === "ready" && pendingComments === 0 ? (
              <Text variant="footnote" style={styles.hint}>
                Tap a line in a diff to comment on it. Comments go with the next message to the{" "}
                {owner.recipientLabel}.
              </Text>
            ) : null
          }
          // The safe area sets this end padding. It changes only on rotation and moves no row.
          // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
          contentContainerStyle={{ paddingBottom: endSpace }}
          refreshControl={
            gate.open ? (
              <ListRefreshControl refreshing={manualRefresh.isRefreshing} onRefresh={refresh} />
            ) : undefined
          }
        />
        <DiffCommentBar flow={flow} recipientLabel={owner.recipientLabel} />
      </KeyboardInsetView>
      {comparisonChoice ? (
        <ComparisonBranchPicker
          repoPath={owner.repoPath}
          choice={comparisonChoice}
          checkout={currentBranch}
          visible={choosingTarget}
          onClose={() => setChoosingTarget(false)}
        />
      ) : null}
    </>
  );
}

const keyOf = (row: ChangesRow): string => row.key;

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  header: { gap: theme.space.md, paddingTop: theme.space.sm },
  hint: {
    textAlign: "center",
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.lg,
    color: theme.desktop.mutedForeground,
  },
}));
