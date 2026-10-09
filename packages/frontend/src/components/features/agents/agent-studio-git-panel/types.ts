import type { InlineCommentOwner } from "@/types/inline-comment-owner";
import type { PullRequest, SystemOpenInToolId } from "@openducktor/contracts";
import type { ReactNode } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import type {
  AgentStudioPendingForcePush,
  AgentStudioPendingPullRebase,
  AgentStudioPendingReset,
  DiffDataState,
  GitConflict,
  GitConflictAction,
} from "@/features/agent-studio-git";

export type AgentStudioGitPanelModel = DiffDataState & {
  /** Identifies the task or session that the panel shows. A new value clears the file search and opens all directories. */
  subjectKey: string;
  contextMode?: "repository" | "worktree";
  /** A repository-root branch switcher shown in repository mode. */
  repositoryBranchControl?: ReactNode;
  comparisonUnavailableReason?: string | null;
  commentOwner?: InlineCommentOwner | null;
  commentPlaceholder?: string;
  pullRequest?: PullRequest | null;
  openInTargetPath?: string | null;
  openInDisabledReason?: string | null;
  isCommitting?: boolean;
  isPushing?: boolean;
  isRebasing?: boolean;
  isResetting?: boolean;
  isResetDisabled?: boolean;
  resetDisabledReason?: string | null;
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
  pendingReset?: AgentStudioPendingReset | null;
  commitError?: string | null;
  pushError?: string | null;
  rebaseError?: string | null;
  conflictRecipientLabel?: "Builder" | "agent";
  conflictAssistanceBlockedReason?: string | null;
  conflictAssistanceIsStarting?: boolean;
  resetError?: string | null;
  isDetectingPullRequest?: boolean;
  detectPullRequestDisabledReason?: string | null;
  commitAll?: (message: string) => Promise<boolean>;
  requestFileReset?: (filePath: string) => void;
  requestHunkReset?: (filePath: string, hunkIndex: number) => void;
  confirmReset?: () => Promise<void>;
  cancelReset?: () => void;
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
  targetBranchOptions?: ComboboxOption[];
  targetBranchSelectionValue?: string;
  onUpdateTargetBranch?: (selection: string) => Promise<void>;
};
