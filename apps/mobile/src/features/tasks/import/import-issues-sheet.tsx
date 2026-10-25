import type { IssueItemsListResult, SourceIssue, WorkspaceRecord } from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { RESULT_UNKNOWN_TITLE } from "@openducktor/frontend-core/lib/command-outcome";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import { collectKnownLabels } from "@openducktor/frontend-core/tasks/create/task-composer-options";
import {
  ISSUE_IMPORT_INCOMPLETE_RESULTS_TEXT,
  ISSUE_IMPORT_LABELS,
  type IssueImportStep,
  issueImportCreatedMessage,
  issueImportEmptyText,
  issueImportHasPages,
  issueImportListQueryOptions,
  issueImportLoadingText,
  issueImportPageSummary,
  issueImportSearchField,
  issueImportSelectedTitle,
  issueImportStepDescription,
  issueImportTitle,
  issueImportUnavailableReason,
  nextIssueImportCursors,
  selectedItemsWithCurrentLinks,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-model";
import {
  type IssueImportProvider,
  issueImportSourceLabel,
  toIssueImportState,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-provider";
import {
  useIssueImportSearch,
  useIssueImportSubmission,
  useIssueSelectionState,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-state";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Fragment,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, type DimensionValue, ScrollView, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { StyleSheet } from "react-native-unistyles";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import {
  OtherWorkspaceState,
  SelectedWorkspaceGate,
} from "@/features/workspaces/no-open-workspace";
import { useCommandGate } from "@/host-session/active-session-context";
import { SheetScreen } from "@/navigation/sheet-screen";
import { useAppTheme } from "@/theme/app-theme-context";
import { FormFooter } from "@/ui/action-form";
import { Button } from "@/ui/button";
import { useLinkOpener } from "@/rich-content/links/use-link-opener";
import { withAlpha } from "@/theme/color-alpha";
import { Chip } from "@/ui/chip";
import { Screen } from "@/ui/screen";
import { SearchField } from "@/ui/search-field";
import { SkeletonFrame } from "@/ui/placeholders";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import { ToolbarButton } from "../edit/form-parts";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { IssueReviewCard } from "./issue-review-card";
import { IssueRow, IssueRowPlaceholder } from "./issue-row";

/** Mobile has no repository settings, so the texts tell where they are. */
const SETTINGS_ELSEWHERE = "The repository settings are in the desktop or web app.";

const SHEET_TITLE = "Import Issues";
const keyOf = (item: SourceIssue): string => item.sourceId;

/** Import issues of the selected workspace: select, review, and import, as on desktop. */
export function ImportIssuesRoute(): ReactElement {
  const params = useLocalSearchParams<{ workspaceId: string }>();
  const { selectedWorkspace } = useMobileWorkspaces();
  if (
    selectedWorkspace &&
    (!params.workspaceId || selectedWorkspace.workspaceId === params.workspaceId)
  ) {
    return <ImportIssuesContent workspace={selectedWorkspace} />;
  }
  return (
    <GroupedSheet title={SHEET_TITLE}>
      <SelectedWorkspaceGate>{() => <OtherWorkspaceState />}</SelectedWorkspaceGate>
    </GroupedSheet>
  );
}

function ImportIssuesContent({ workspace }: { workspace: WorkspaceRecord }): ReactElement {
  const provider = useQuery(repositoryGitProviderContextQueryOptions(workspace.repoPath));
  const state = toIssueImportState(provider.data, provider.error);
  switch (state.kind) {
    case "loading":
      return (
        <GroupedSheet title={SHEET_TITLE}>
          <LoadingState label="Loading the Git provider" />
        </GroupedSheet>
      );
    case "read_failed":
      return (
        <GroupedSheet title={SHEET_TITLE}>
          <ErrorState
            title="The Git Provider Did Not Load"
            message={state.reason}
            onRetry={() => void provider.refetch()}
          />
        </GroupedSheet>
      );
    case "setup_missing":
      return (
        <GroupedSheet title={SHEET_TITLE}>
          <EmptyState
            icon="settings"
            title="No Issue Provider"
            message={`Turn on GitHub or Azure DevOps with issue access in the repository settings. Then open Import Issues again. ${SETTINGS_ELSEWHERE}`}
          />
        </GroupedSheet>
      );
    case "ready":
      return <IssueImportFlow workspace={workspace} provider={state.provider} />;
  }
}

function IssueImportFlow({
  workspace,
  provider,
}: {
  workspace: WorkspaceRecord;
  provider: IssueImportProvider;
}): ReactElement {
  const router = useRouter();
  const gate = useCommandGate();
  const { feedback } = useClientConnection();
  const openLink = useLinkOpener(undefined);
  const { tasks } = useRequiredContext(TasksStateContext, "IssueImportFlow");
  const knownLabels = useMemo(() => collectKnownLabels(tasks), [tasks]);
  const { repoPath } = workspace;
  const [step, setStep] = useState<IssueImportStep>("select");
  const search = useIssueImportSearch();
  const selection = useIssueSelectionState();
  const unavailableReason = issueImportUnavailableReason(provider);
  const query = useQuery({
    ...issueImportListQueryOptions({
      repoPath,
      provider,
      search: search.search,
      cursor: search.cursors[search.pageIndex],
    }),
    enabled: unavailableReason === null && !search.searchPending,
    // The last page stays visible while a search or another page loads.
    placeholderData: keepPreviousData,
  });
  const items = query.data?.items ?? EMPTY_ITEMS;
  const selectedItems = selectedItemsWithCurrentLinks(selection.selected, items);
  const submission = useIssueImportSubmission({
    selectedItems,
    reviews: selection.reviews,
    repoPath,
    providerId: provider.config.id,
    providerScope: provider.config,
    onComplete: (createdCount) => {
      feedback.show("success", issueImportCreatedMessage(createdCount));
      router.back();
    },
    onRefreshed: selection.replaceItem,
  });
  const busy = submission.isSubmitting || submission.refreshingId !== null;
  const pendingCount = submission.pendingItems.length;
  const removeItem = (sourceId: string) => {
    selection.removeItem(sourceId);
    submission.clearOutcome(sourceId);
  };
  const toggleItem = (item: SourceIssue) => {
    if (selection.selected.has(item.sourceId)) submission.clearOutcome(item.sourceId);
    selection.toggleItem(item);
  };

  const primary =
    unavailableReason === null ? (
      <ImportPrimaryAction
        step={step}
        pendingCount={pendingCount}
        blocked={busy}
        submitting={submission.isSubmitting}
        onReview={() => setStep("review")}
        onImport={() => void submission.importItems()}
      />
    ) : null;
  const background = step === "select" ? "plain" : "grouped";

  let content: ReactElement;
  if (unavailableReason) {
    content = (
      <View style={styles.padded}>
        <Callout
          tone="warning"
          title={`${issueImportSourceLabel(provider.config.id)} are not available`}
          message={`${unavailableReason} ${SETTINGS_ELSEWHERE}`}
        />
      </View>
    );
  } else if (step === "select") {
    content = (
      <SelectStep
        provider={provider}
        search={search}
        query={query}
        items={items}
        selectedItems={selectedItems}
        selectedIds={selection.selected}
        onToggle={toggleItem}
        onOpen={(item) => openLink(item.url)}
      />
    );
  } else {
    content = (
      <ReviewStep
        selectedItems={selectedItems}
        selection={selection}
        submission={submission}
        knownLabels={knownLabels}
        busy={busy}
        commandsOpen={gate.open}
        onBack={() => setStep("select")}
        onOpen={(item) => openLink(item.url)}
        onRemove={removeItem}
      />
    );
  }

  return (
    <SheetScreen
      title={issueImportTitle(provider.config.id)}
      closable={!busy}
      background={background}
    >
      <Screen background={background}>
        <View style={styles.fill}>{content}</View>
        <FormFooter primary={primary} />
      </Screen>
    </SheetScreen>
  );
}

/** The footer action of a step: Review in the select step, then Import in the review step. */
function ImportPrimaryAction({
  step,
  pendingCount,
  blocked,
  submitting,
  onReview,
  onImport,
}: {
  step: IssueImportStep;
  /** The selected items that are not imported yet. */
  pendingCount: number;
  /** True while a refresh or an import runs. */
  blocked: boolean;
  submitting: boolean;
  onReview: () => void;
  onImport: () => void;
}): ReactElement {
  if (step === "select") {
    return (
      <Button
        label="Review"
        size="lg"
        trailingIcon="chevron-right"
        disabled={pendingCount === 0}
        onPress={onReview}
        fill
      />
    );
  }
  return (
    <Button
      label="Import"
      icon="download"
      size="lg"
      command
      loading={submitting}
      disabled={blocked || pendingCount === 0}
      onPress={onImport}
      fill
    />
  );
}

/** The review step: one card for each selected item, then the import failure. */
function ReviewStep({
  selectedItems,
  selection,
  submission,
  knownLabels,
  busy,
  commandsOpen,
  onBack,
  onOpen,
  onRemove,
}: {
  selectedItems: SourceIssue[];
  selection: ReturnType<typeof useIssueSelectionState>;
  submission: ReturnType<typeof useIssueImportSubmission>;
  knownLabels: readonly string[];
  busy: boolean;
  commandsOpen: boolean;
  onBack: () => void;
  onOpen: (item: SourceIssue) => void;
  onRemove: (sourceId: string) => void;
}): ReactElement {
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
      bottomOffset={24}
      contentContainerStyle={styles.review}
    >
      <View style={styles.reviewIntro}>
        <ToolbarButton
          label={ISSUE_IMPORT_LABELS.back}
          icon="arrow-left"
          variant="outline"
          disabled={busy}
          accessibilityLabel="Back to the item selection"
          onPress={onBack}
        />
        <Text variant="footnote" tone="tertiary" style={styles.flex}>
          {`${issueImportSelectedTitle(selectedItems.length)}. ${issueImportStepDescription("review")}`}
        </Text>
      </View>
      {selectedItems.map((item) => {
        const review = selection.reviews.get(item.sourceId);
        if (!review) return null;
        return (
          <IssueReviewCard
            key={item.sourceId}
            item={item}
            review={review}
            outcome={submission.outcomes.get(item.sourceId)}
            knownLabels={reviewLabelSuggestions(item.tags, knownLabels)}
            busy={busy}
            refreshing={submission.refreshingId === item.sourceId}
            onOpen={() => onOpen(item)}
            onRemove={() => onRemove(item.sourceId)}
            onChange={(update) => selection.changeReview(item.sourceId, update)}
            onRefresh={() => void submission.refreshItem(item.sourceId)}
          />
        );
      })}
      {submission.submitError ? (
        <Callout
          tone={submission.submitErrorOutcomeUnknown ? "warning" : "destructive"}
          title={submission.submitErrorOutcomeUnknown ? RESULT_UNKNOWN_TITLE : "Import failed"}
          message={submission.submitError}
        />
      ) : null}
      {commandsOpen ? null : (
        <Text variant="footnote" tone="secondary" style={styles.center}>
          Import is available when the host connection is live.
        </Text>
      )}
    </KeyboardAwareScrollView>
  );
}

/**
 * The select step: a search field, the Selected filter, and the open items of one page as check
 * rows. Selections stay when the search or the page changes.
 */
function SelectStep({
  provider,
  search,
  query,
  items,
  selectedItems,
  selectedIds,
  onToggle,
  onOpen,
}: {
  provider: IssueImportProvider;
  search: ReturnType<typeof useIssueImportSearch>;
  query: UseQueryResult<IssueItemsListResult>;
  items: SourceIssue[];
  selectedItems: SourceIssue[];
  selectedIds: ReadonlyMap<string, SourceIssue>;
  onToggle: (item: SourceIssue) => void;
  onOpen: (item: SourceIssue) => void;
}): ReactElement {
  const [onlySelected, setOnlySelected] = useState(false);
  const searchField = issueImportSearchField(provider);
  const loading = search.searchPending || query.isFetching;
  const showSelected = onlySelected && selectedItems.length > 0;

  const toggleShown = (item: SourceIssue) => {
    // The Selected filter ends with its last item, so the list does not go empty.
    if (showSelected && selectedItems.length === 1 && selectedIds.has(item.sourceId)) {
      setOnlySelected(false);
    }
    onToggle(item);
  };
  // The rows keep stable handlers, and the handlers read the latest selection.
  const handlers = useRef({ onToggle: toggleShown, onOpen });
  useEffect(() => {
    handlers.current = { onToggle: toggleShown, onOpen };
  });
  const toggle = useCallback((item: SourceIssue) => handlers.current.onToggle(item), []);
  const open = useCallback((item: SourceIssue) => handlers.current.onOpen(item), []);
  const renderItem = useCallback<ListRenderItem<SourceIssue>>(
    ({ item }) => (
      <IssueRow
        item={item}
        selected={selectedIds.has(item.sourceId)}
        onToggle={toggle}
        onOpen={open}
      />
    ),
    [open, selectedIds, toggle],
  );

  // The Selected filter shows the selected items whatever the page read does.
  const listState = showSelected
    ? "list"
    : issueListState({
        loaded: query.data !== undefined,
        failed: query.isError,
        empty: items.length === 0 && !loading,
      });
  return (
    <View style={styles.selectRoot}>
      <View style={styles.toolbar}>
        <Text variant="footnote" tone="tertiary">
          {issueImportStepDescription("select")}
        </Text>
        {searchField ? (
          <SearchField
            value={search.searchText}
            onChangeText={search.setSearchText}
            placeholder={searchField.placeholder}
            accessibilityLabel={searchField.label}
          />
        ) : null}
        <View style={styles.filters}>
          <Chip
            label={issueImportSelectedTitle(selectedItems.length)}
            accessibilityLabel={`Show only the selected items, ${selectedItems.length} selected`}
            selected={showSelected}
            disabled={selectedItems.length === 0}
            onPress={() => setOnlySelected((current) => !current)}
          />
          <View style={styles.flex} />
          {loading ? <IssueListLoading searchText={search.searchText} /> : null}
        </View>
      </View>
      <IssueList
        state={listState}
        query={query}
        search={search}
        data={showSelected ? selectedItems : items}
        pageItemCount={items.length}
        showsPages={!showSelected}
        loading={loading}
        renderItem={renderItem}
      />
    </View>
  );
}

/** The rows of the select step, or the state of a page list that has no rows to show. */
function IssueList({
  state,
  query,
  search,
  data,
  pageItemCount,
  showsPages,
  loading,
  renderItem,
}: {
  state: ReturnType<typeof issueListState>;
  query: UseQueryResult<IssueItemsListResult>;
  search: ReturnType<typeof useIssueImportSearch>;
  data: SourceIssue[];
  /** The items of the page, also while the Selected filter shows other rows. */
  pageItemCount: number;
  showsPages: boolean;
  loading: boolean;
  renderItem: ListRenderItem<SourceIssue>;
}): ReactElement {
  switch (state) {
    case "failed":
      return (
        <ErrorState
          title="The Items Did Not Load"
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      );
    case "loading":
      return <IssueListSkeleton />;
    case "empty":
      return (
        <EmptyState
          icon="search-x"
          title="No Open Items"
          message={issueImportEmptyText(search.searchText)}
        />
      );
    case "list":
      return (
        <FlashList
          data={data}
          keyExtractor={keyOf}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={RowSeparator}
          ListHeaderComponent={
            query.isError ? (
              <IssueListFailure error={query.error} onRetry={() => void query.refetch()} />
            ) : null
          }
          ListFooterComponent={
            showsPages ? (
              <IssueListPages
                search={search}
                itemCount={pageItemCount}
                nextCursor={query.data?.nextCursor}
                incomplete={query.data?.incompleteResults === true}
                loading={loading}
              />
            ) : null
          }
        />
      );
  }
}

/** The page list before its first answer: a failure, a load, no open item, or the rows. */
const issueListState = ({
  loaded,
  failed,
  empty,
}: {
  loaded: boolean;
  failed: boolean;
  empty: boolean;
}): "failed" | "loading" | "empty" | "list" => {
  if (!loaded) return failed ? "failed" : "loading";
  return empty ? "empty" : "list";
};

/** A page read that failed after the list showed items, with Retry. */
function IssueListFailure({ error, onRetry }: { error: Error; onRetry: () => void }): ReactElement {
  return (
    <View style={styles.listHeader}>
      <Callout
        tone="destructive"
        title="The items did not load"
        message={errorMessage(error)}
        action={
          <ToolbarButton
            label={ISSUE_IMPORT_LABELS.retry}
            icon="refresh"
            variant="outline"
            onPress={onRetry}
          />
        }
      />
    </View>
  );
}

/** The incomplete results note, the page summary, and the page controls. */
function IssueListPages({
  search,
  itemCount,
  nextCursor,
  incomplete,
  loading,
}: {
  search: ReturnType<typeof useIssueImportSearch>;
  itemCount: number;
  nextCursor: string | undefined;
  incomplete: boolean;
  loading: boolean;
}): ReactElement {
  const { pageIndex } = search;
  const hasPages = issueImportHasPages(pageIndex, nextCursor);
  const next = () => {
    if (!nextCursor) return;
    search.setCursors((current) => nextIssueImportCursors(current, pageIndex, nextCursor));
    search.setPageIndex(pageIndex + 1);
  };
  return (
    <>
      {incomplete ? (
        <Text variant="footnote" tone="tertiary" style={styles.incomplete}>
          {ISSUE_IMPORT_INCOMPLETE_RESULTS_TEXT}
        </Text>
      ) : null}
      <View style={styles.pages}>
        {hasPages ? (
          <ToolbarButton
            label={ISSUE_IMPORT_LABELS.previousPage}
            variant="outline"
            disabled={pageIndex === 0 || loading}
            accessibilityLabel="Previous page"
            onPress={() => search.setPageIndex(pageIndex - 1)}
          />
        ) : null}
        <Text variant="footnote" tone="tertiary" tabular style={styles.pageSummary}>
          {issueImportPageSummary(pageIndex, itemCount, hasPages)}
        </Text>
        {hasPages ? (
          <ToolbarButton
            label={ISSUE_IMPORT_LABELS.nextPage}
            variant="outline"
            disabled={!nextCursor || loading}
            accessibilityLabel="Next page"
            onPress={next}
          />
        ) : null}
      </View>
    </>
  );
}

/** The search or page load in progress, beside the Selected filter. */
function IssueListLoading({ searchText }: { searchText: string }): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.loading} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={theme.colors.secondaryLabel} />
      <Text variant="footnote" tone="secondary">
        {issueImportLoadingText(searchText)}
      </Text>
    </View>
  );
}

function RowSeparator(): ReactElement {
  return <View style={styles.separator} />;
}

/** Title and author widths that change from row to row, as real items do. */
const PLACEHOLDER_ITEMS: readonly { id: string; title: DimensionValue; meta: DimensionValue }[] = [
  { id: "item-1", title: "78%", meta: "46%" },
  { id: "item-2", title: "62%", meta: "38%" },
  { id: "item-3", title: "84%", meta: "52%" },
  { id: "item-4", title: "56%", meta: "42%" },
  { id: "item-5", title: "72%", meta: "34%" },
  { id: "item-6", title: "66%", meta: "48%" },
  { id: "item-7", title: "80%", meta: "40%" },
  { id: "item-8", title: "58%", meta: "44%" },
];

/**
 * The items for their first load, in the layout of the loaded list: the rows and the lines
 * between them. The list then takes the place of each row.
 */
function IssueListSkeleton(): ReactElement {
  return (
    <ScrollView scrollEnabled={false} contentContainerStyle={styles.list}>
      <SkeletonFrame label="Loading items">
        {PLACEHOLDER_ITEMS.map((item, index) => (
          <Fragment key={item.id}>
            {index > 0 ? <RowSeparator /> : null}
            <IssueRowPlaceholder titleWidth={item.title} metaWidth={item.meta} />
          </Fragment>
        ))}
      </SkeletonFrame>
    </ScrollView>
  );
}

const EMPTY_ITEMS: SourceIssue[] = [];

/** The suggestions of a review: the provider tags of the item, then the workspace labels. */
const reviewLabelSuggestions = (
  tags: readonly string[],
  knownLabels: readonly string[],
): string[] => [...new Set([...tags, ...knownLabels])];

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  padded: { padding: theme.layout.screenPadding },
  selectRoot: { flex: 1, backgroundColor: theme.desktop.card },
  toolbar: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.desktop.border,
    backgroundColor: withAlpha(theme.desktop.muted, 0.2),
  },
  filters: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  loading: { flexDirection: "row", alignItems: "center", gap: 6 },
  list: { paddingBottom: theme.space.huge },
  listHeader: { padding: theme.layout.screenPadding },
  separator: { height: 1, backgroundColor: theme.desktop.border },
  incomplete: {
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
  },
  pages: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
  },
  pageSummary: { flex: 1, textAlign: "center" },
  review: {
    gap: theme.space.lg,
    padding: theme.layout.screenPadding,
    paddingBottom: theme.space.huge,
  },
  reviewIntro: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
}));
