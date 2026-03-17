import type { PullRequest } from "@openducktor/contracts";
import type {
  AgentStudioPendingForcePush,
  AgentStudioPendingPullRebase,
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
  commitError?: string | null;
  pushError?: string | null;
  rebaseError?: string | null;
  isDetectingPullRequest?: boolean;
  commitAll?: (message: string) => Promise<boolean>;
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
  onSendReview?: (message: string) => void;
};
