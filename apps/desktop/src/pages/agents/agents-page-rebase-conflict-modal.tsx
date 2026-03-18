import type { ReactElement } from "react";
import {
  GitConflictResolutionModal,
  useGitConflictResolutionModalState,
} from "@/features/git-conflict-resolution";
import type {
  PendingRebaseConflictResolutionRequest,
  RebaseConflictResolutionDecision,
} from "./use-agent-studio-rebase-conflict-resolution";

type RebaseConflictResolutionModalProps = {
  request: PendingRebaseConflictResolutionRequest;
  onResolve: (decision: RebaseConflictResolutionDecision) => void;
};

export { useGitConflictResolutionModalState as useRebaseConflictResolutionModalState };

export function RebaseConflictResolutionModal({
  request,
  onResolve,
}: RebaseConflictResolutionModalProps): ReactElement {
  return <GitConflictResolutionModal request={request} onResolve={onResolve} />;
}
