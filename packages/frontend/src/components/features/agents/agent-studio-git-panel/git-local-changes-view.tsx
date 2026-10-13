import type { GitFileDiff, GitChangeGroup, GitLocalChanges } from "@openducktor/contracts";
import { AlertTriangle, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import {
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { Button } from "@/components/ui/button";
import { type GitChangeIntent, gitChangeIntentKey } from "@/features/agent-studio-git";
import { cn } from "@/lib/utils";
import {
  type InlineCommentDraft,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { FileDiffList } from "./file-diff-list";
import { FileListHeader } from "./file-list-header";
import { searchFiles } from "./file-list-search";
import type { FileListViewMode } from "./file-list-view-preference";
import { GROUP_TOGGLE, type GitFileRowActions, listFileKey } from "./git-file-row-actions";
import { type LocalCommentGroup, placeLocalComments } from "./git-local-comment-placement";
import type { FileListSearch, FileListState } from "./use-file-list-state";

const EMPTY_DRAFTS: InlineCommentDraft[] = [];
const NO_FILES: ReadonlySet<string> = new Set();

type GroupSection = {
  group: LocalCommentGroup;
  title: string;
  fileDiffs: GitFileDiff[];
};

export type GitLocalChangesViewProps = {
  subjectKey: string;
  localChanges: GitLocalChanges;
  ownerKey: string | null;
  commentPlaceholder?: string | undefined;
  diffStyle: PierreDiffStyle;
  setDiffStyle: (style: PierreDiffStyle) => void;
  viewMode: FileListViewMode;
  onViewModeChange: (viewMode: FileListViewMode) => void;
  search: FileListSearch;
  /** Directory state of each group. The panel keeps it across tab changes. */
  listStates: Record<LocalCommentGroup, FileListState>;
  expandedFiles: ReadonlySet<string>;
  onToggleFile: (fileKey: string) => void;
  onViewFile: ((filePath: string) => void) | null;
  collapsedGroups: readonly GitChangeGroup[];
  onToggleGroup: (group: GitChangeGroup) => void;
  preloadLimit: number;
  changeDisabledReason: string | null;
  changingKey: string | null;
  onChange: ((intent: GitChangeIntent) => void) | null;
};

export const GitLocalChangesView = memo(function GitLocalChangesView({
  subjectKey,
  localChanges,
  ownerKey,
  commentPlaceholder,
  diffStyle,
  setDiffStyle,
  viewMode,
  onViewModeChange,
  search,
  listStates,
  expandedFiles,
  onToggleFile,
  onViewFile,
  collapsedGroups,
  onToggleGroup,
  preloadLimit,
  changeDisabledReason,
  changingKey,
  onChange,
}: GitLocalChangesViewProps): ReactElement {
  const sections = useMemo<GroupSection[]>(() => {
    const groups: GroupSection[] = [];
    if (localChanges.conflicted.fileDiffs.length > 0) {
      groups.push({
        group: "conflicted",
        title: "Conflicts",
        fileDiffs: localChanges.conflicted.fileDiffs,
      });
    }
    groups.push(
      { group: "unstaged", title: "Unstaged", fileDiffs: localChanges.unstaged.fileDiffs },
      { group: "staged", title: "Staged", fileDiffs: localChanges.staged.fileDiffs },
    );
    return groups;
  }, [localChanges]);
  const drafts = useInlineCommentDraftStore((store) =>
    ownerKey === null ? EMPTY_DRAFTS : (store.draftsByOwner[ownerKey] ?? EMPTY_DRAFTS),
  );
  const commentsByGroup = useMemo(() => placeLocalComments(drafts, sections), [drafts, sections]);
  const conflictedFiles = useMemo(
    () => new Set(localChanges.conflicted.fileStatuses.map((status) => status.path)),
    [localChanges.conflicted.fileStatuses],
  );
  const header = useLocalHeaderCounts(sections, search.query);
  const collapsed = useMemo(() => new Set(collapsedGroups), [collapsedGroups]);
  const sectionOf = (group: LocalCommentGroup): GroupSection | undefined =>
    sections.find((section) => section.group === group);
  const conflictedSection = sectionOf("conflicted");
  const unstagedSection = sectionOf("unstaged");
  const stagedSection = sectionOf("staged");
  const renderSection = (section: GroupSection | undefined): ReactElement | null =>
    section ? (
      <LocalGroupSection
        section={section}
        subjectKey={subjectKey}
        collapsed={section.group !== "conflicted" && collapsed.has(section.group)}
        onToggleGroup={onToggleGroup}
        commentsByFile={commentsByGroup[section.group]}
        ownerKey={ownerKey}
        commentPlaceholder={commentPlaceholder}
        conflictedFiles={section.group === "conflicted" ? conflictedFiles : NO_FILES}
        diffStyle={diffStyle}
        setDiffStyle={setDiffStyle}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        listState={listStates[section.group]}
        expandedFiles={expandedFiles}
        onToggleFile={onToggleFile}
        onViewFile={onViewFile}
        preloadLimit={preloadLimit}
        changeDisabledReason={changeDisabledReason}
        changingKey={changingKey}
        onChange={onChange}
      />
    ) : null;

  return (
    <div
      className="@container/git-local flex h-full min-h-0 flex-col"
      data-testid="agent-studio-git-local-changes"
    >
      <FileListHeader
        fileCount={header.fileCount}
        matchCount={search.query === "" ? null : header.matchCount}
        totalAdditions={header.additions}
        totalDeletions={header.deletions}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        searchText={search.searchText}
        onSearchTextChange={search.setSearchText}
      />
      {conflictedSection ? (
        <div className="flex max-h-[40%] min-h-0 shrink-0 flex-col">
          {renderSection(conflictedSection)}
        </div>
      ) : null}
      <LocalGroupPanes
        unstaged={renderSection(unstagedSection)}
        staged={renderSection(stagedSection)}
        unstagedOpen={!collapsed.has("unstaged")}
        stagedOpen={!collapsed.has("staged")}
      />
    </div>
  );
});

const MIN_SHARE = 0.15;
const KEY_STEP = 0.05;

/**
 * Unstaged and Staged share the height in two halves, like the commit view of a Git client. The
 * handle between them changes the split, and a double-click restores the halves. A closed group
 * keeps only its header, and the other group takes the space. Each group keeps its element, so a
 * list keeps its scroll position.
 */
function LocalGroupPanes({
  unstaged,
  staged,
  unstagedOpen,
  stagedOpen,
}: {
  unstaged: ReactElement | null;
  staged: ReactElement | null;
  unstagedOpen: boolean;
  stagedOpen: boolean;
}): ReactElement {
  const container = useRef<HTMLDivElement | null>(null);
  const [share, setShare] = useState(0.5);
  const bothOpen = unstagedOpen && stagedOpen;
  const clamp = (value: number) => Math.min(1 - MIN_SHARE, Math.max(MIN_SHARE, value));
  const moveTo = (clientY: number): void => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds || bounds.height === 0) return;
    setShare(clamp((clientY - bounds.top) / bounds.height));
  };
  const flex = (open: boolean, part: number) => (open ? `${bothOpen ? part : 1} 1 0%` : "0 0 auto");
  return (
    <div ref={container} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-col" style={{ flex: flex(unstagedOpen, share) }}>
        {unstaged}
      </div>
      {bothOpen ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the staged and unstaged lists"
          aria-valuemin={MIN_SHARE * 100}
          aria-valuemax={(1 - MIN_SHARE) * 100}
          aria-valuenow={Math.round(share * 100)}
          tabIndex={0}
          className="group/split relative z-10 -my-1 h-2 shrink-0 cursor-row-resize outline-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            moveTo(event.clientY);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event.clientY);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            setShare((current) =>
              clamp(current + (event.key === "ArrowUp" ? -KEY_STEP : KEY_STEP)),
            );
          }}
          onDoubleClick={() => setShare(0.5)}
        >
          <span
            className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-transparent transition-colors group-hover/split:bg-primary/50 group-focus-visible/split:bg-ring"
            aria-hidden="true"
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-col" style={{ flex: flex(stagedOpen, 1 - share) }}>
        {staged}
      </div>
    </div>
  );
}

function useLocalHeaderCounts(sections: GroupSection[], query: string) {
  return useMemo(() => {
    const paths = new Set<string>();
    const matchedPaths = new Set<string>();
    let additions = 0;
    let deletions = 0;
    for (const { fileDiffs } of sections) {
      for (const diff of fileDiffs) paths.add(diff.file);
      for (const { diff } of searchFiles(fileDiffs, query)) {
        matchedPaths.add(diff.file);
        additions += diff.additions;
        deletions += diff.deletions;
      }
    }
    return { fileCount: paths.size, matchCount: matchedPaths.size, additions, deletions };
  }, [query, sections]);
}

type LocalGroupSectionProps = Omit<
  GitLocalChangesViewProps,
  "collapsedGroups" | "expandedFiles" | "search" | "listStates" | "subjectKey" | "localChanges"
> & {
  subjectKey: string;
  listState: FileListState;
  section: GroupSection;
  collapsed: boolean;
  commentsByFile: ReadonlyMap<string, InlineCommentDraft[]>;
  conflictedFiles: ReadonlySet<string>;
  expandedFiles: ReadonlySet<string>;
};

function LocalGroupSection({
  section,
  subjectKey,
  collapsed,
  onToggleGroup,
  commentsByFile,
  ownerKey,
  commentPlaceholder,
  conflictedFiles,
  diffStyle,
  setDiffStyle,
  viewMode,
  onViewModeChange,
  listState,
  expandedFiles,
  onToggleFile,
  onViewFile,
  preloadLimit,
  changeDisabledReason,
  changingKey,
  onChange,
}: LocalGroupSectionProps): ReactElement {
  const { group, fileDiffs } = section;
  const changeGroup = group === "conflicted" ? null : group;
  const rowActions = useMemo<GitFileRowActions | null>(() => {
    if (!changeGroup || !onChange) return null;
    return {
      group: changeGroup,
      disabledReason: changeDisabledReason,
      changingKey,
      onChange,
    };
  }, [changeDisabledReason, changeGroup, changingKey, onChange]);
  const groupExpandedFiles = useMemo(() => {
    const files = new Set<string>();
    for (const diff of fileDiffs) {
      if (expandedFiles.has(listFileKey(group, diff.file))) files.add(diff.file);
    }
    return files;
  }, [expandedFiles, fileDiffs, group]);
  const toggleFile = useCallback(
    (filePath: string) => onToggleFile(listFileKey(group, filePath)),
    [group, onToggleFile],
  );
  const hasFiles = fileDiffs.length > 0;
  const isOpen = !collapsed;
  const bodyId = `${subjectKey}-${group}-files`;

  return (
    <section
      aria-label={`${section.title} changes`}
      className={cn("flex min-h-0 flex-col", isOpen && "flex-1")}
      data-testid={`agent-studio-git-group-${group}`}
    >
      {/* The toggle covers the whole header, so a click anywhere on it opens or closes the group. */}
      <div
        className={cn(
          "relative flex h-8 shrink-0 items-center gap-1 border-y border-border/60 bg-muted/40 pr-2 pl-1",
          changeGroup && "transition-colors hover:bg-muted",
        )}
      >
        <GroupTitle
          section={section}
          collapsible={group !== "conflicted"}
          isOpen={isOpen}
          bodyId={bodyId}
          onToggle={() => changeGroup && onToggleGroup(changeGroup)}
        />
        {changeGroup && rowActions && hasFiles ? (
          <GroupAction group={changeGroup} count={fileDiffs.length} rowActions={rowActions} />
        ) : null}
      </div>
      {isOpen ? (
        <div id={bodyId} className="flex min-h-0 flex-1 flex-col">
          {hasFiles ? (
            <FileDiffList
              fileDiffs={fileDiffs}
              diffScope="uncommitted"
              listKey={group}
              listLabel={`${section.title} files`}
              ownerKey={ownerKey}
              commentPlaceholder={commentPlaceholder}
              commentsByFile={commentsByFile}
              conflictedFiles={conflictedFiles}
              diffStyle={diffStyle}
              setDiffStyle={setDiffStyle}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              showHeader={false}
              listState={listState}
              expandedFiles={groupExpandedFiles}
              onToggleFile={toggleFile}
              onViewFile={onViewFile}
              preloadLimit={preloadLimit}
              rowActions={rowActions}
            />
          ) : (
            <p
              className="flex flex-1 items-center justify-center px-3 py-4 text-xs text-muted-foreground"
              data-testid={`agent-studio-git-${group}-empty`}
            >
              {EMPTY_GROUP_TEXT[group]}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

const EMPTY_GROUP_TEXT = {
  conflicted: "No conflicts",
  unstaged: "No unstaged changes",
  staged: "No staged changes",
} satisfies Record<LocalCommentGroup, string>;

function GroupTitle({
  section,
  collapsible,
  isOpen,
  bodyId,
  onToggle,
}: {
  section: GroupSection;
  collapsible: boolean;
  isOpen: boolean;
  bodyId: string;
  onToggle: () => void;
}): ReactElement {
  const content: ReactNode = (
    <>
      {section.group === "conflicted" ? (
        <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
      ) : null}
      <span>{section.title}</span>
      <span
        className="rounded-full bg-background px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
        data-testid={`agent-studio-git-${section.group}-count`}
      >
        {section.fileDiffs.length}
      </span>
    </>
  );
  if (!collapsible) {
    return <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold">{content}</h3>;
  }
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <h3 className="min-w-0">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 text-xs font-semibold outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <Chevron className="size-3.5 text-muted-foreground" />
        {content}
      </button>
    </h3>
  );
}

function GroupAction({
  group,
  count,
  rowActions,
}: {
  group: GitChangeGroup;
  count: number;
  rowActions: GitFileRowActions;
}): ReactElement {
  const { action, label: toggleLabel, icon: Icon } = GROUP_TOGGLE[group];
  const intent: GitChangeIntent = { action, group, selection: { kind: "all" } };
  const isPending = rowActions.changingKey === gitChangeIntentKey(intent);
  const files = `${count} ${group} file${count === 1 ? "" : "s"}`;
  const label = `${toggleLabel} all`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      // The action sits above the header toggle, so its click does not close the group.
      className="relative z-10 ml-auto h-6 gap-1 px-2 text-xs disabled:pointer-events-auto disabled:cursor-not-allowed"
      aria-label={`${label}: ${files}, including files that the search hides`}
      title={
        rowActions.disabledReason ?? `${label}: ${files}, including files that the search hides`
      }
      // A running action takes no second click. Other changes wait in the queue.
      disabled={rowActions.disabledReason !== null || isPending}
      data-testid={`agent-studio-git-${intent.action}-all-button`}
      onClick={() => rowActions.onChange(intent)}
    >
      {isPending ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {/* A narrow panel keeps the icon. The accessible name keeps the label. */}
      <span className="hidden @[16rem]/git-local:inline">{label}</span>
    </Button>
  );
}
