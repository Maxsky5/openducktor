import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import type { GitChangeGroup, PullRequest, SystemOpenInToolId } from "@openducktor/contracts";
import type { ReactNode } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import type {
  AgentStudioPendingDiscard,
  AgentStudioPendingForcePush,
  AgentStudioPendingPullRebase,
  DiffDataState,
  GitChangeIntent,
  GitCommitMode,
  GitConflict,
  GitConflictAction,
} from "@openducktor/frontend-core/git/contracts";
import type { GitPanelTab } from "./constants";
import type { GitPanelConflict } from "./use-git-conflict-panel";
import type { PanelFileLists } from "./use-panel-file-lists";

export type AgentStudioGitPanelModel = DiffDataState & {
  /** Identifies the task or session that the panel shows. A new value clears the file search and opens all directories. */
  subjectKey: string;
  contextMode?: "repository" | "worktree";
  /** A repository-root branch switcher shown in repository mode. */
  repositoryBranchControl?: ReactNode;
  /** The manual Refresh. Its state shows a failure, so it does not reject. */
  refresh: () => Promise<void>;
  commentOwner?: InlineCommentOwner | null;
  commentPlaceholder?: string;
  pullRequest?: PullRequest | null;
  openInTargetPath?: string | null;
  openInDisabledReason?: string | null;
  isRefreshing?: boolean;
  refreshError?: string | null;
  isCommitting?: boolean;
  committingMode?: GitCommitMode | null;
  isPushing?: boolean;
  isRebasing?: boolean;
  isChanging?: boolean;
  changingKey?: string | null;
  /** Stage and Unstage requests that Git has not shown yet. The panel shows their result. */
  pendingChanges?: readonly GitChangeIntent[];
  changeDisabledReason?: string | null;
  isHandlingGitConflict?: boolean;
  gitConflictAction?: GitConflictAction;
  gitConflictAutoOpenNonce?: number;
  gitConflictCloseNonce?: number;
  showLockReasonBanner?: boolean;
  isGitActionsLocked?: boolean;
  gitActionsLockReason?: string | null;
  gitConflict?: GitConflict | null;
  pendingForcePush?: AgentStudioPendingForcePush | null;
  pendingPullRebase?: AgentStudioPendingPullRebase | null;
  pendingDiscard?: AgentStudioPendingDiscard | null;
  commitError?: string | null;
  pushError?: string | null;
  rebaseError?: string | null;
  changeError?: string | null;
  conflictRecipientLabel?: "Builder" | "agent";
  conflictAssistanceBlockedReason?: string | null;
  conflictAssistanceIsStarting?: boolean;
  isDetectingPullRequest?: boolean;
  detectPullRequestDisabledReason?: string | null;
  commit?: (mode: GitCommitMode, message: string) => Promise<boolean>;
  changeSelection?: (intent: GitChangeIntent) => void;
  /** Opens the file preview of a path in the Git working directory, or null when no preview exists. */
  onViewFile?: ((filePath: string) => void) | null;
  confirmDiscard?: () => Promise<void>;
  cancelDiscard?: () => void;
  pushBranch?: () => Promise<void>;
  confirmForcePush?: () => Promise<void>;
  cancelForcePush?: () => void;
  confirmPullRebase?: () => Promise<void>;
  cancelPullRebase?: () => void;
  rebaseOntoTarget?: (() => Promise<void>) | undefined;
  abortGitConflict?: () => Promise<void>;
  askBuilderToResolveGitConflict?: (() => Promise<void>) | undefined;
  pullFromUpstream?: () => Promise<void>;
  onDetectPullRequest?: () => Promise<void> | void;
  openDirectoryInTool?: (toolId: SystemOpenInToolId) => Promise<void>;
  targetBranchEditable?: boolean | undefined;
  targetBranchHelpText?: string | undefined;
  targetBranchesPending?: boolean | undefined;
  targetBranchesError?: string | null | undefined;
  retryTargetBranches?: (() => Promise<void>) | undefined;
  targetBranchOptions?: ComboboxOption[];
  targetBranchSelectionValue?: string;
  onUpdateTargetBranch?: ((selection: string) => Promise<void>) | undefined;
};

/** The view state that the panel gives its parts. It stays the same across tab changes. */
export type GitPanelView = {
  contextKey: string;
  activeTab: GitPanelTab;
  onTabChange: (tab: GitPanelTab) => void;
  conflict: GitPanelConflict;
  expandedFiles: ReadonlySet<string>;
  onToggleFile: (fileKey: string) => void;
  collapsedGroups: readonly GitChangeGroup[];
  onToggleGroup: (group: GitChangeGroup) => void;
  diffStyle: PierreDiffStyle;
  setDiffStyle: (style: PierreDiffStyle) => void;
  lists: PanelFileLists;
};
