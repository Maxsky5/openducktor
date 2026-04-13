import type { PullRequest } from "@openducktor/contracts";
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
  contextMode?: "repository" | "worktree";
  pullRequest?: PullRequest | null;
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
  resetError?: string | null;
  isDetectingPullRequest?: boolean;
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
  rebaseOntoTarget?: () => Promise<void>;
  abortGitConflict?: () => Promise<void>;
  askBuilderToResolveGitConflict?: () => Promise<void>;
  pullFromUpstream?: () => Promise<void>;
  onDetectPullRequest?: () => Promise<void> | void;
  targetBranchOptions?: ComboboxOption[];
  targetBranchSelectionValue?: string;
  onUpdateTargetBranch?: (selection: string) => Promise<void>;
  onSendReview?: (message: string) => void;
};
