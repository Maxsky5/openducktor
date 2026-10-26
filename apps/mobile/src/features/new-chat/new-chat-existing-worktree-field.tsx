import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { useWorkspaceSessionCreate } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import type { ReactElement } from "react";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { FormField, type MenuChoice, MenuSelect } from "@/ui/form-rows";

type CreateForm = ReturnType<typeof useWorkspaceSessionCreate>;

const folderName = (path: string): string => path.split("/").filter(Boolean).at(-1) ?? path;

/**
 * The registered worktrees of the repository, as the desktop Existing worktree field. The user
 * picks one. The full path of the choice shows under the field.
 */
export function ExistingWorktreeField({
  form,
  disabled,
}: {
  form: CreateForm;
  disabled: boolean;
}): ReactElement {
  const { worktrees, selected, isSelectedListed, isSelectedUnavailable } = form.existing;
  const entries = worktrees.data?.worktrees ?? [];
  const isEmpty = worktrees.isSuccess && entries.length === 0;
  const choices: MenuChoice[] = entries.map((entry) => ({
    value: entry.workingDirectory,
    label: `${folderName(entry.workingDirectory)} · ${entry.branchName ?? "Detached HEAD"}`,
  }));
  // The choice stays in the list after a refresh removes it, so the user sees what to correct.
  if (selected !== null && !isSelectedListed) {
    choices.push({
      value: selected,
      label: `${folderName(selected)} · No longer available`,
      disabled: true,
    });
  }
  let placeholder = "Select a worktree";
  if (worktrees.isPending) placeholder = "Loading worktrees…";
  else if (worktrees.isError) placeholder = "Worktrees did not load";
  return (
    <>
      <FormField
        label="Worktree"
        hint={
          selected === null
            ? "Chats that use this worktree share its files and branch."
            : `${selected}\nChats that use this worktree share its files and branch.`
        }
      >
        <MenuSelect
          title="Worktree"
          choices={choices}
          selected={selected}
          placeholder={placeholder}
          icon="folder-git-2"
          disabled={disabled || !worktrees.isSuccess || isEmpty}
          onSelect={form.selectExistingWorktree}
        />
      </FormField>
      {isEmpty ? (
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
              label="Try Again"
              variant="gray"
              size="sm"
              disabled={disabled || worktrees.isFetching}
              onPress={() => void worktrees.refetch()}
            />
          }
        />
      ) : null}
      {isSelectedUnavailable ? (
        <Callout
          tone="destructive"
          message="The selected worktree is no longer available. Select another worktree."
        />
      ) : null}
    </>
  );
}
