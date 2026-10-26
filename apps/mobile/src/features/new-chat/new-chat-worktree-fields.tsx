import type { GitBranch } from "@openducktor/contracts";
import type { useWorkspaceSessionCreate } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import {
  changeWorktreeMode,
  existingBranchUnavailableReason,
  localWorktreeBranches,
  newWorktreeBranchState,
  selectExistingBranch,
  WORKTREE_NAME_MAX_LENGTH,
} from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";
import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BranchPickerSheet } from "@/features/branches/branch-picker-sheet";
import { SegmentedControl, TextField } from "@/ui/fields";
import { FormField, FormPanel, SelectTrigger } from "@/ui/form-rows";
import type { OptionChoice } from "@/ui/option-picker-model";
import { Text } from "@/ui/text";
import type { NewChatRequest } from "./new-chat-request";

type CreateForm = ReturnType<typeof useWorkspaceSessionCreate>;

/** The worktree branch modes, in the desktop order. */
const WORKTREE_MODES = [
  { value: "from_branch", label: "Existing branch" },
  { value: "from_name", label: "New branch" },
] as const;

/** The local branches that a new worktree can use, with the reason when one is unavailable. */
const toBranchChoices = (branches: readonly GitBranch[] | undefined): OptionChoice[] | undefined =>
  branches
    ? localWorktreeBranches(branches).map((branch) => {
        const unavailable = existingBranchUnavailableReason(branch);
        return {
          value: branch.name,
          label: branch.name,
          detail: unavailable ?? (branch.isCurrent ? "Current branch" : null),
          disabled: unavailable !== null,
        };
      })
    : undefined;

/** The worktree of a new chat: an existing or a new branch, its name, and where it goes. */
export function WorktreeFields({
  form,
  request,
  branchPrefix,
  prefixFailed,
  disabled,
}: {
  form: CreateForm;
  request: NewChatRequest;
  branchPrefix: string | undefined;
  /** True when the branch prefix of the repository did not load. */
  prefixFailed: boolean;
  disabled: boolean;
}): ReactElement {
  const { worktree } = form;
  return (
    <FormPanel>
      <SegmentedControl
        label="Worktree creation mode"
        options={WORKTREE_MODES}
        value={worktree.mode}
        disabled={disabled}
        onChange={(mode) => form.changeWorktree(changeWorktreeMode(worktree, mode))}
      />
      {worktree.mode === "from_branch" ? (
        <ExistingBranchField form={form} error={request.fieldErrors.branch} disabled={disabled} />
      ) : (
        <Text variant="footnote" tone="tertiary">
          Creates a new branch from the committed HEAD of the current checkout.
        </Text>
      )}
      <TextField
        label="Worktree name"
        value={worktree.name}
        onChangeText={(name) => form.changeWorktree({ ...worktree, name })}
        placeholder="my-feature"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        maxLength={WORKTREE_NAME_MAX_LENGTH}
        mono
        editable={!disabled}
        error={request.fieldErrors.worktreeName}
        hint="Spaces and slashes become hyphens in the directory name."
      />
      {worktree.mode === "from_name" ? (
        <TextField
          label="Branch name"
          optional
          value={worktree.branchName ?? ""}
          onChangeText={(branchName) =>
            form.changeWorktree({
              mode: "from_name",
              name: worktree.name,
              branchName: branchName || null,
            })
          }
          placeholder={
            newWorktreeBranchState(worktree, branchPrefix).defaultBranch || "feature/my-feature"
          }
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          mono
          editable={!disabled}
          error={request.fieldErrors.branch}
          hint={
            prefixFailed
              ? "The branch prefix of the repository did not load. Type a branch name, or load the Default Model again above."
              : null
          }
        />
      ) : null}
      <WorktreeSummary
        directory={request.worktreeSummary.directory}
        branch={request.worktreeSummary.branch}
        newBranch={worktree.mode === "from_name"}
      />
    </FormPanel>
  );
}

/** The local branch that a worktree uses directly, with its picker. */
function ExistingBranchField({
  form,
  error,
  disabled,
}: {
  form: CreateForm;
  error: string | null;
  disabled: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { worktree } = form;
  return (
    <FormField
      label="Existing branch"
      error={error}
      hint="Uses this branch directly. It must not be checked out elsewhere."
    >
      <SelectTrigger
        value={worktree.branchName || null}
        placeholder="Select a local branch"
        icon="git-branch"
        mono
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityLabel="Existing branch"
        accessibilityHint="Opens the local branches of the repository."
      />
      <BranchPickerSheet
        visible={open}
        title="Branch"
        hint="The chat works on this branch. It must not be checked out elsewhere."
        choices={toBranchChoices(form.branches.data)}
        error={form.branches.error}
        onRetry={() => void form.branches.refetch()}
        selected={worktree.branchName}
        emptyMessage="This repository has no local branch. Use a new branch instead."
        onSelect={(name) => form.changeWorktree(selectExistingBranch(worktree, name))}
        onClose={() => setOpen(false)}
      />
    </FormField>
  );
}

/** The directory and the branch that the new worktree gets. */
function WorktreeSummary({
  directory,
  branch,
  newBranch,
}: {
  directory: string | null;
  branch: string | null;
  newBranch: boolean;
}): ReactElement | null {
  if (!directory && !branch) return null;
  return (
    <View style={styles.summary}>
      {directory ? (
        <Text variant="footnote" tone="tertiary" selectable>
          {"Directory "}
          <Text variant="monoSmall" tone="secondary">
            {directory}
          </Text>
        </Text>
      ) : null}
      {branch ? (
        <Text variant="footnote" tone="tertiary" selectable>
          {newBranch ? "New branch " : "Branch "}
          <Text variant="monoSmall" tone="secondary">
            {branch}
          </Text>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  summary: { gap: theme.space.xxs },
}));
