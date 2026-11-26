import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { WorkspaceSessionDraftOptionsModel } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import {
  branchNamedByFirstMessage,
  changeWorktreeMode,
  selectExistingBranch,
  WORKTREE_NAME_MAX_LENGTH,
  WORKTREE_NAME_OPTIONAL_HINT,
  worktreeDirectoryName,
  worktreeNameOptional,
} from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";
import { type ReactElement, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BranchPickerSheet } from "@/features/branches/branch-picker-sheet";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { SegmentedControl, TextField } from "@/ui/fields";
import {
  FormBody,
  FormField,
  FormPanel,
  type MenuChoice,
  MenuSelect,
  OptionCard,
  SelectTrigger,
} from "@/ui/form-rows";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import type { OptionChoice } from "@/ui/option-picker-model";
import { Text } from "@/ui/text";

const WORKTREE_MODES = [
  { value: "from_branch", label: "Existing branch" },
  { value: "from_name", label: "New branch" },
] as const;

function LocalWorktreeSummary({
  worktree,
}: {
  worktree: WorkspaceSessionDraftOptionsModel["options"]["worktree"];
}): ReactElement | null {
  const directory = worktreeDirectoryName(worktree.name);
  const branch = worktree.branchName?.trim() || null;
  const namedByFirstMessage = branchNamedByFirstMessage(worktree);
  if (!directory && !branch && !namedByFirstMessage) return null;
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
      {namedByFirstMessage ? (
        <Text variant="footnote" tone="tertiary">
          {directory
            ? "Branch named from your first message"
            : "Directory and branch named from your first message"}
        </Text>
      ) : null}
      {branch ? (
        <Text variant="footnote" tone="tertiary" selectable>
          {worktree.mode === "from_name" ? "New branch " : "Branch "}
          <Text variant="monoSmall" tone="secondary">
            {branch}
          </Text>
        </Text>
      ) : null}
    </View>
  );
}

function LocalWorktreeBranchInput({
  optionsModel,
  disabled,
}: {
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
}): ReactElement {
  const [existingBranchOpen, setExistingBranchOpen] = useState(false);
  const { options, repoConfig, branches, fieldErrors, localBranchChoices, onChangeWorktree } =
    optionsModel;
  const { worktree } = options;
  const branchChoices = useMemo<OptionChoice[] | undefined>(
    () =>
      localBranchChoices?.map(({ branch, unavailableReason }) => ({
        value: branch.name,
        label: branch.name,
        detail: unavailableReason ?? (branch.isCurrent ? "Current branch" : null),
        disabled: unavailableReason !== null,
      })),
    [localBranchChoices],
  );

  if (worktree.mode === "from_branch") {
    return (
      <FormField
        label="Existing branch"
        error={fieldErrors.worktreeBranch}
        hint="Uses this branch directly. It must not be checked out elsewhere."
      >
        <SelectTrigger
          value={worktree.branchName || null}
          placeholder="Select a local branch"
          icon="git-branch"
          mono
          disabled={disabled}
          onPress={() => setExistingBranchOpen(true)}
          accessibilityLabel="Existing branch"
          accessibilityHint="Opens the local branches of the repository."
        />
        <BranchPickerSheet
          visible={existingBranchOpen}
          title="Branch"
          hint="The session works on this branch. It must not be checked out elsewhere."
          choices={branchChoices}
          error={branches.error}
          onRetry={() => void branches.refetch()}
          selected={worktree.branchName}
          emptyMessage="This repository has no local branch. Use a new branch instead."
          onSelect={(name) => onChangeWorktree(selectExistingBranch(worktree, name))}
          onClose={() => setExistingBranchOpen(false)}
        />
      </FormField>
    );
  }

  return (
    <>
      <Text variant="footnote" tone="tertiary">
        Creates a new branch from the committed HEAD of the current checkout.
      </Text>
      <TextField
        label="Branch name"
        optional
        value={worktree.branchName ?? ""}
        onChangeText={(branchName) =>
          onChangeWorktree({
            mode: "from_name",
            name: worktree.name,
            branchName: branchName || null,
          })
        }
        placeholder="Named from first message"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        mono
        editable={!disabled}
        error={fieldErrors.worktreeBranch}
        hint={
          repoConfig.isError
            ? "The branch prefix of the repository did not load. Type a branch name or retry settings."
            : null
        }
      />
    </>
  );
}

function LocalWorktreeFormFields({
  optionsModel,
  disabled,
}: {
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
}): ReactElement {
  const { options, fieldErrors, onChangeWorktree } = optionsModel;
  const nameOptional = worktreeNameOptional(options.worktree);
  return (
    <FormPanel>
      <SegmentedControl
        label="Worktree creation mode"
        options={WORKTREE_MODES}
        value={options.worktree.mode}
        disabled={disabled}
        onChange={(mode) => onChangeWorktree(changeWorktreeMode(options.worktree, mode))}
      />
      <TextField
        label="Worktree name"
        optional={nameOptional}
        value={options.worktree.name}
        onChangeText={(name) => onChangeWorktree({ ...options.worktree, name })}
        placeholder="my-feature"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        maxLength={WORKTREE_NAME_MAX_LENGTH}
        mono
        editable={!disabled}
        error={fieldErrors.worktreeName}
        hint={
          nameOptional
            ? `Spaces and slashes become hyphens in the directory name. ${WORKTREE_NAME_OPTIONAL_HINT}`
            : "Spaces and slashes become hyphens in the directory name."
        }
      />
      <LocalWorktreeBranchInput optionsModel={optionsModel} disabled={disabled} />
      <LocalWorktreeSummary worktree={options.worktree} />
    </FormPanel>
  );
}

const existingWorktreePlaceholder = (
  worktrees: Pick<WorkspaceSessionDraftOptionsModel["worktrees"], "isPending" | "isError">,
): string => {
  if (worktrees.isPending) return "Loading worktrees…";
  if (worktrees.isError) return "Worktrees did not load";
  return "Select a worktree";
};

function ExistingWorktreeFormFields({
  optionsModel,
  disabled,
}: {
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
}): ReactElement {
  const { options, worktrees, fieldErrors, existingWorktreeChoices, onSelectExistingWorktree } =
    optionsModel;
  const selectedExisting = options.existingWorktreeDirectory;
  const isWorktreesEmpty = worktrees.isSuccess && (worktrees.data?.worktrees.length ?? 0) === 0;
  const existingChoices = useMemo<MenuChoice[]>(
    () =>
      existingWorktreeChoices.map((choice) => ({
        value: choice.value,
        label: `${choice.label} · ${choice.description}`,
        disabled: choice.disabled,
      })),
    [existingWorktreeChoices],
  );
  const placeholder = existingWorktreePlaceholder(worktrees);

  return (
    <>
      <FormField
        label="Worktree"
        error={fieldErrors.existingWorktree}
        hint={
          selectedExisting === null
            ? "Sessions that use this worktree share its files and branch."
            : `${selectedExisting}\nSessions that use this worktree share its files and branch.`
        }
      >
        <MenuSelect
          title="Worktree"
          choices={existingChoices}
          selected={selectedExisting}
          placeholder={placeholder}
          icon="folder-git-2"
          disabled={disabled || !worktrees.isSuccess || isWorktreesEmpty}
          onSelect={onSelectExistingWorktree}
        />
      </FormField>
      {isWorktreesEmpty ? (
        <Callout
          tone="info"
          message="No other worktrees exist for this repository. Use New worktree to create one."
        />
      ) : null}
      {worktrees.isError ? (
        <Callout
          tone="destructive"
          title="Worktrees did not load"
          message={errorMessage(worktrees.error)}
          action={
            <Button
              label="Retry"
              variant="gray"
              size="sm"
              disabled={disabled || worktrees.isFetching}
              onPress={() => void worktrees.refetch()}
            />
          }
        />
      ) : null}
    </>
  );
}

export function LocationOptionsSheet({
  visible,
  onClose,
  optionsModel,
  disabled,
}: {
  visible: boolean;
  onClose: () => void;
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
}): ReactElement {
  const { options, onSelectLocation } = optionsModel;
  return (
    <InPlaceSheet visible={visible} title="Work location" onClose={onClose}>
      <FormBody>
        <FormField label="Work location">
          <View style={styles.locations} accessibilityRole="radiogroup">
            <OptionCard
              variant="primary"
              icon="folder"
              title="Current checkout"
              description="Work with the files already here."
              selected={options.location === "local_repo_root"}
              disabled={disabled}
              onPress={() => onSelectLocation("local_repo_root")}
            />
            <OptionCard
              variant="primary"
              icon="git-branch"
              title="New worktree"
              description="Use an isolated directory and branch."
              selected={options.location === "local_worktree"}
              disabled={disabled}
              onPress={() => onSelectLocation("local_worktree")}
            />
            <OptionCard
              variant="primary"
              icon="folder-git-2"
              title="Existing worktree"
              description="Use a worktree that already exists."
              selected={options.location === "existing_worktree"}
              disabled={disabled}
              onPress={() => onSelectLocation("existing_worktree")}
            />
          </View>
        </FormField>
        {options.location === "local_worktree" ? (
          <LocalWorktreeFormFields optionsModel={optionsModel} disabled={disabled} />
        ) : null}
        {options.location === "existing_worktree" ? (
          <ExistingWorktreeFormFields optionsModel={optionsModel} disabled={disabled} />
        ) : null}
      </FormBody>
    </InPlaceSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  locations: { gap: theme.space.sm },
  summary: { gap: theme.space.xxs },
}));
