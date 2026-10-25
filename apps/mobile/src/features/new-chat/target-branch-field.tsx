import { type GitTargetBranch, UPSTREAM_TARGET_BRANCH } from "@openducktor/contracts";
import { sessionComparisonOptions } from "@openducktor/frontend-core/git/session-comparison-options";
import {
  canonicalTargetBranch,
  targetBranchFromSelection,
  targetBranchSelectionValue,
} from "@openducktor/frontend-core/lib/target-branch";
import type { useWorkspaceSessionCreate } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import { type ReactElement, useMemo, useState } from "react";
import { BranchPickerSheet } from "@/features/branches/branch-picker-sheet";
import { FormField, SelectTrigger } from "@/ui/form-rows";

type CreateForm = ReturnType<typeof useWorkspaceSessionCreate>;

const HINT = "The Git panel and diffs of this chat compare with this branch.";

const targetLabel = (target: GitTargetBranch): string =>
  target.branch === UPSTREAM_TARGET_BRANCH ? "Tracked upstream" : canonicalTargetBranch(target);

/**
 * The target branch of a new chat, as the desktop field: the repository branches, with the
 * repository default marked. Only the current checkout can compare with the tracked upstream.
 */
export function TargetBranchField({
  form,
  disabled,
}: {
  form: CreateForm;
  disabled: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { targetBranch, defaultTarget, branches, location } = form;
  const choices = useMemo(
    () =>
      branches.data
        ? sessionComparisonOptions(branches.data, targetBranch, {
            allowUpstream: location === "local_repo_root",
            defaultTarget,
          })
        : undefined,
    [branches.data, defaultTarget, location, targetBranch],
  );
  return (
    <FormField label="Target branch" hint={HINT}>
      <SelectTrigger
        value={targetBranch ? targetLabel(targetBranch) : null}
        placeholder={branches.isPending ? "Loading branches…" : "Select a target branch"}
        icon="git-branch"
        mono
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityLabel="Target branch"
        accessibilityHint="Opens the branches of the repository."
      />
      <BranchPickerSheet
        visible={open}
        title="Target Branch"
        hint={HINT}
        choices={choices}
        error={branches.error}
        onRetry={() => void branches.refetch()}
        selected={targetBranch ? targetBranchSelectionValue(targetBranch) : null}
        onSelect={(value) => form.pickTarget(targetBranchFromSelection(value))}
        onClose={() => setOpen(false)}
      />
    </FormField>
  );
}
