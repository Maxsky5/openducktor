import {
  effectiveWorkspaceSessionTargetBranch,
  type GitBranch,
  type GitTargetBranch,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { type ReactElement, useId } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { sessionComparisonOptions } from "@openducktor/frontend-core/git/session-comparison-options";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  targetBranchFromSelection,
  targetBranchSelectionValue,
} from "@openducktor/frontend-core/lib/target-branch";
import { updateWorkspaceSessionQueries } from "@openducktor/frontend-core/queries/workspace-sessions";

type Props = {
  workspaceId: string;
  record: WorkspaceSession;
  defaultTarget: GitTargetBranch | null;
  branches: UseQueryResult<GitBranch[]>;
  disabled: boolean;
  onSaved: () => void;
};

/**
 * Restore recreates a removed worktree from the chat target. The archived chat can change that
 * target here, for example when the saved branch no longer exists.
 */
export function WorkspaceSessionRemovedWorktreeTarget({
  workspaceId,
  record,
  defaultTarget,
  branches,
  disabled,
  onSaved,
}: Props): ReactElement {
  const host = useHostClient();
  const queryClient = useQueryClient();
  const labelId = useId();
  const target = effectiveWorkspaceSessionTargetBranch(
    record.executionTarget.kind,
    record.targetBranch,
    defaultTarget,
  );
  const save = useMutation({
    mutationFn: (targetBranch: GitTargetBranch) =>
      host.workspaceSessionSetTargetBranch({ workspaceId, sessionId: record.id, targetBranch }),
    onSuccess: (session) => {
      updateWorkspaceSessionQueries(queryClient, workspaceId, session);
      onSaved();
    },
  });
  return (
    <div className="mt-1 grid gap-1">
      <p id={labelId} className="text-xs text-muted-foreground">
        Worktree removed. Restore recreates it from this target branch.
      </p>
      <BranchSelector
        triggerAriaLabelledBy={labelId}
        value={target ? targetBranchSelectionValue(target) : ""}
        options={sessionComparisonOptions(branches.data ?? [], target, { defaultTarget })}
        placeholder={branches.isPending ? "Loading branches…" : "Choose a target branch"}
        disabled={disabled || save.isPending}
        onValueChange={(selection) => save.mutate(targetBranchFromSelection(selection))}
      />
      {save.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(save.error)}
        </p>
      )}
    </div>
  );
}
