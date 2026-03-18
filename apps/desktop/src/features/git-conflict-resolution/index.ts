export { getGitConflictCopy, getGitConflictTitle } from "./conflict-copy";
export { GIT_CONFLICT_TEST_IDS, INLINE_CODE_CLASS_NAME } from "./constants";
export {
  createGitConflictActionsModel,
  GitConflictActions,
  type GitConflictActionsModel,
} from "./git-conflict-actions";
export { GitConflictDialog } from "./git-conflict-dialog";
export {
  GitConflictResolutionModal,
  useGitConflictResolutionModalState,
} from "./git-conflict-resolution-modal";
export { GitConflictStrip } from "./git-conflict-strip";
export type {
  GitConflictResolutionDecision,
  PendingGitConflictResolutionRequest,
} from "./use-git-conflict-resolution";
export { useGitConflictResolution } from "./use-git-conflict-resolution";
