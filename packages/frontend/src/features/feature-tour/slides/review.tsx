import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import type { DiffLineAnnotation } from "@pierre/diffs";
import { ChevronDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import {
  DiffAnnotationShell,
  DraftCommentCard,
} from "@/components/features/agents/agent-studio-git-panel/file-diff-comments";
import { FILE_STATUS_COLOR } from "@/components/features/agents/agent-studio-git-panel/constants";
import { GitInfoHeader } from "@/components/features/agents/agent-studio-git-panel/git-info-header";
import { PierreFilePairDiffViewer } from "@/components/features/agents/pierre-file-pair-diff-viewer";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import { cn } from "@/lib/utils";
import { TourPanelTabs, TourStudio } from "../feature-tour-app-parts";
import { noop, SESSIONS } from "../feature-tour-samples";
import { type FeatureTourSlide, type TourPart, TourPiece } from "../feature-tour-stage";
import { REVIEW_ROWS } from "../feature-tour-transcripts";

// Slide 8: Human Review in the session of the Builder.

const noopAsync = async (): Promise<void> => {};

const PARTS: readonly TourPart[] = [
  {
    title: "Task branch",
    text: "The build runs on its own branch, in its own worktree, and merges into main.",
    pin: { x: 723, y: 97, side: "right" },
  },
  {
    title: "Line comment",
    text: "Comment on a line of the diff. It waits until you send your next message.",
    pin: { x: 858, y: 470, side: "right" },
  },
  {
    title: "Send",
    text: "The badge counts the comments that go with your next message.",
    pin: { x: 361, y: 575, side: "bottom" },
  },
  {
    title: "Approve Task",
    text: "Open the approval flow: merge, open a pull request, or close the task.",
    pin: { x: 704, y: 4, side: "top" },
  },
];

/** The task session at its size in app pixels. */
const STUDIO = { width: 870, height: 595 } as const;

/** The session of the picture: QA approved the build, and the task waits for your review. */
const SESSION = SESSIONS.shortcutReviewBuild;

/** The file of the sample keyboard shortcut hook. */
const HOOK_PATH = "src/search/use-search-shortcut.ts";

/** The status color of a modified file, as the Git panel looks it up. */
const MODIFIED_COLOR = FILE_STATUS_COLOR.get("modified") ?? "text-muted-foreground";

const HOOK_LINES = [
  'import { useEffect } from "react";',
  "",
  'const isMac = navigator.platform === "MacIntel";',
  'const fields = "input, textarea";',
  "",
  "export function useSearchShortcut(open: () => void) {",
  "  useEffect(() => {",
  "    const onKey = (e: KeyboardEvent) => {",
  "      const mod = isMac ? e.metaKey : e.ctrlKey;",
  "      if (!mod || e.shiftKey) return;",
  '      if (e.key.toLowerCase() !== "k") return;',
  "      const el = e.target as Element;",
  "      if (el.closest(fields)) return;",
  "      e.preventDefault();",
  "      open();",
  "    };",
  '    addEventListener("keydown", onKey);',
  '    return () => removeEventListener("keydown", onKey);',
  "  }, [open]);",
  "}",
];

/** The hook after the QA fix: Alt is ignored too, and an open dialog keeps the shortcut. */
const REVIEWED_HOOK_LINES = [
  ...HOOK_LINES.slice(0, 9),
  "      if (!mod || e.shiftKey || e.altKey) return;",
  ...HOOK_LINES.slice(10, 11),
  '      if (document.querySelector("dialog[open]")) return;',
  ...HOOK_LINES.slice(11),
];

const REVIEW_COMMENT: InlineCommentDraft = {
  id: "tour-comment",
  filePath: HOOK_PATH,
  diffScope: "target",
  startLine: 10,
  endLine: 10,
  side: "new",
  text: "Also return early when e.defaultPrevented is true, so a component that handles the shortcut keeps it.",
  codeContext: [],
  language: "typescript",
  revision: 1,
  submissionId: null,
  createdAt: 0,
  updatedAt: 0,
  status: "pending",
};

const REVIEW_ANNOTATIONS: DiffLineAnnotation<unknown>[] = [
  { side: "additions", lineNumber: 10, metadata: { commentId: REVIEW_COMMENT.id } },
];

const renderReviewComment = (): ReactNode => (
  <DiffAnnotationShell>
    <DraftCommentCard
      comment={REVIEW_COMMENT}
      isEditing={false}
      editingText=""
      onEditingTextChange={noop}
      onStartEditing={noop}
      onCancelEditing={noop}
      onSaveEditing={noop}
      onRemove={noop}
    />
  </DiffAnnotationShell>
);

/** The Diffs tab of the right panel: the branch of the task and the diff of one file. */
function TourDiffPanel(): ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <TourPanelTabs selected="diffs" />
      <GitInfoHeader
        targetBranchEditable={false}
        targetBranchHelpText={undefined}
        targetBranchesPending={false}
        targetBranchesError={null}
        retryTargetBranches={noopAsync}
        contextMode="worktree"
        comparisonPending={false}
        branchKnown
        comparisonUnavailableReason={null}
        comparisonReference={null}
        pullRequest={null}
        branch={`odt/${SESSION.context.task.id}`}
        targetBranch="main"
        commitsAheadBehind={{ ahead: 2, behind: 0 }}
        upstreamAheadBehind={null}
        upstreamStatus="tracking"
        upstreamError={null}
        isLoading={false}
        isCommitting={false}
        isPushing={false}
        isRebasing={false}
        isChanging={false}
        isDetectingPullRequest={false}
        detectPullRequestDisabledReason={null}
        isGitActionsLocked={false}
        gitActionsLockReason={null}
        showLockReasonBanner={false}
        pushError={null}
        rebaseError={null}
        targetBranchOptions={[]}
        targetBranchSelectionValue=""
        onUpdateTargetBranch={noopAsync}
        activeTab="target"
        onTabChange={noop}
        uncommittedTabCount={null}
        targetTabCount={2}
        isRefreshing={false}
        refreshError={null}
        uncommittedFileCount={0}
        pushBranch={null}
        rebaseOntoTarget={null}
        pullFromUpstream={null}
        onRefresh={noop}
      />
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        <FileTypeIcon filePath="use-search-shortcut.ts" className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">use-search-shortcut.ts</span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] whitespace-nowrap tabular-nums">
          <span className={cn("font-semibold", MODIFIED_COLOR)}>M</span>
          <span className="text-green-600 dark:text-green-400">+2</span>
          <span className="text-red-600 dark:text-red-400">-1</span>
        </span>
      </div>
      {/* The diff ends on the bottom edge of line 12, 12 app px above the window edge, so no code
          line shows cut. */}
      <div className="mb-3 min-h-0 flex-1 overflow-hidden">
        <PierreFilePairDiffViewer
          filePath={HOOK_PATH}
          oldContent={`${HOOK_LINES.join("\n")}\n`}
          newContent={`${REVIEWED_HOOK_LINES.join("\n")}\n`}
          diffStyle="unified"
          heightMode="full"
          lineOverflow="wrap"
          lineAnnotations={REVIEW_ANNOTATIONS}
          renderAnnotation={renderReviewComment}
        />
      </div>
    </div>
  );
}

function ReviewStage(): ReactElement {
  return (
    <TourPiece x={0} y={0} width={STUDIO.width} height={STUDIO.height}>
      <div
        className="relative flex flex-col overflow-hidden bg-card"
        style={{ width: STUDIO.width, height: STUDIO.height }}
      >
        <TourStudio
          session={SESSION}
          actionLabel="Approve Task"
          rows={REVIEW_ROWS}
          pendingComments={1}
          draft="Please also handle my comment on line 10."
          panel={<TourDiffPanel />}
          panelShare={54}
        />
      </div>
    </TourPiece>
  );
}

export const reviewSlide: FeatureTourSlide = {
  id: "review",
  title: "You stay in control",
  text: "Each build runs in its own Git worktree, so your main checkout stays clean. When QA approves a task, it moves to Human Review: comment on its diff, send the comments to the Builder, or approve it.",
  explainer: { width: STUDIO.width, height: STUDIO.height, parts: PARTS, stage: <ReviewStage /> },
};
