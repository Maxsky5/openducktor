import type { DiffDataState } from "@/pages/agents/use-agent-studio-diff-data";
import type {
  AgentStudioPendingForcePush,
  AgentStudioPendingPullRebase,
  AgentStudioRebaseConflict,
  AgentStudioRebaseConflictAction,
} from "@/pages/agents/use-agent-studio-git-actions";

export type AgentStudioGitPanelModel = DiffDataState & {
  contextMode?: "repository" | "worktree";
  isCommitting?: boolean;
  isPushing?: boolean;
  isRebasing?: boolean;
  isHandlingRebaseConflict?: boolean;
  rebaseConflictAction?: AgentStudioRebaseConflictAction;
  rebaseConflictAutoOpenNonce?: number;
  rebaseConflictCloseNonce?: number;
  showLockReasonBanner?: boolean;
  isGitActionsLocked?: boolean;
  gitActionsLockReason?: string | null;
  rebaseConflict?: AgentStudioRebaseConflict | null;
  pendingForcePush?: AgentStudioPendingForcePush | null;
  pendingPullRebase?: AgentStudioPendingPullRebase | null;
  commitError?: string | null;
  pushError?: string | null;
  rebaseError?: string | null;
  commitAll?: (message: string) => Promise<boolean>;
  pushBranch?: () => Promise<void>;
  confirmForcePush?: () => Promise<void>;
  cancelForcePush?: () => void;
  confirmPullRebase?: () => Promise<void>;
  cancelPullRebase?: () => void;
  rebaseOntoTarget?: () => Promise<void>;
  abortRebase?: () => Promise<void>;
  askBuilderToResolveRebaseConflict?: () => Promise<void>;
  pullFromUpstream?: () => Promise<void>;
  onSendReview?: (message: string) => void;
};
