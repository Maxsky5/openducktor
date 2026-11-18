import type { GitBranch, WorkspaceSessionWorktreeInput } from "@openducktor/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { toBranchSelectorOptions } from "@openducktor/frontend-core/lib/branch-selector-model";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  branchNamedByFirstMessage,
  existingBranchError,
  existingBranchUnavailableReason,
  INVALID_BRANCH_NAME,
  localWorktreeBranches,
  newWorktreeBranchState,
  selectExistingBranch,
  WORKTREE_NAME_MAX_LENGTH,
  worktreeDirectoryName,
  worktreeNameError,
  worktreeNameOptional,
  WORKTREE_NAME_OPTIONAL_HINT,
  type WorkspaceSessionWorktreeFieldError,
} from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";

export type WorktreeInputProps = {
  value: WorkspaceSessionWorktreeInput;
  onChange: (value: WorkspaceSessionWorktreeInput) => void;
  disabled: boolean;
  error: WorkspaceSessionWorktreeFieldError | null;
};

function WorktreeBranchValidation({ message }: { message: string | null }) {
  return message ? (
    <p
      id="workspace-session-branch-error"
      role="alert"
      className="break-words text-sm text-destructive"
    >
      {message}
    </p>
  ) : null;
}

export function ExistingWorktreeBranchFields({
  value,
  onChange,
  disabled,
  error,
  branches,
}: WorktreeInputProps & { branches: UseQueryResult<GitBranch[]> }) {
  const localBranches = localWorktreeBranches(branches.data);
  const branchOptions = toBranchSelectorOptions(localBranches).map((option, index) => {
    const branch = localBranches[index];
    const unavailableReason = branch ? existingBranchUnavailableReason(branch) : null;
    return unavailableReason
      ? { ...option, disabled: true, description: unavailableReason }
      : option;
  });
  const branchFailure = existingBranchError(value, localBranches, error);

  return (
    <div className="grid gap-1.5">
      <Label id="workspace-session-existing-branch">Existing branch</Label>
      <Combobox
        triggerAriaLabelledBy="workspace-session-existing-branch"
        triggerAriaDescribedBy={
          branchFailure
            ? "workspace-session-existing-branch-hint workspace-session-branch-error"
            : "workspace-session-existing-branch-hint"
        }
        value={value.branchName ?? ""}
        options={branchOptions}
        placeholder={branches.isPending ? "Loading branches…" : "Select a local branch"}
        disabled={disabled || branches.isPending || branches.isError}
        onValueChange={(branchName) => onChange(selectExistingBranch(value, branchName))}
      />
      <p id="workspace-session-existing-branch-hint" className="text-xs text-muted-foreground">
        Uses this branch directly. It must not be checked out elsewhere.
      </p>
      <WorktreeBranchValidation message={branchFailure} />
    </div>
  );
}

export function WorktreeNameField({
  value,
  onChange,
  disabled,
  error,
  hasNamingModel = false,
}: WorktreeInputProps & {
  /** True when the workspace has a naming model, so a new branch worktree can have a blank name. */
  hasNamingModel?: boolean;
}) {
  const directoryName = worktreeDirectoryName(value.name);
  const nameError = worktreeNameError(value.name, error);
  const optional = worktreeNameOptional(value, hasNamingModel);

  return (
    <div className="grid gap-1.5" data-invalid={Boolean(nameError) || undefined}>
      <Label htmlFor="workspace-session-worktree-name">
        {optional ? (
          <>
            Worktree name <span className="font-normal text-muted-foreground">optional</span>
          </>
        ) : (
          "Worktree name"
        )}
      </Label>
      <Input
        id="workspace-session-worktree-name"
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
        placeholder="my-feature"
        autoComplete="off"
        maxLength={WORKTREE_NAME_MAX_LENGTH}
        disabled={disabled}
        aria-invalid={Boolean(nameError)}
        aria-describedby={
          nameError
            ? "workspace-session-worktree-name-hint workspace-session-worktree-name-error"
            : "workspace-session-worktree-name-hint"
        }
      />
      <p id="workspace-session-worktree-name-hint" className="text-xs text-muted-foreground">
        Spaces and slashes become hyphens in the directory name.
        {optional ? ` ${WORKTREE_NAME_OPTIONAL_HINT}` : null}
      </p>
      {directoryName !== null && (
        <p className="break-all text-xs text-muted-foreground">
          Directory: <span className="font-mono">{directoryName}</span>
        </p>
      )}
      {nameError && (
        <p
          id="workspace-session-worktree-name-error"
          role="alert"
          className="break-words text-xs text-destructive"
        >
          {nameError}
        </p>
      )}
    </div>
  );
}

/** The branch that the new worktree gets: typed, from the worktree name, or from the first message. */
function NewBranchPreview({
  branch,
  namedByFirstMessage,
}: {
  branch: string;
  namedByFirstMessage: boolean;
}) {
  if (namedByFirstMessage)
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        New branch: named from your first message
      </p>
    );
  if (!branch) return null;
  return (
    <p className="mt-1 break-all text-xs text-muted-foreground">
      New branch: <span className="font-mono">{branch}</span>
    </p>
  );
}

export function NewWorktreeBranchFields({
  workspace,
  value,
  onChange,
  disabled,
  error,
  alwaysExpanded = false,
  hasNamingModel = false,
}: WorktreeInputProps & {
  workspace: ActiveWorkspace;
  alwaysExpanded?: boolean;
  /** True when the workspace has a naming model, so a blank name lets the first message name the branch. */
  hasNamingModel?: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const config = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const { branchError, defaultBranch } = newWorktreeBranchState(value, config.data?.branchPrefix);

  const branchFailure = error?.field === "worktree.branchName" ? error.message : null;
  if (value.mode !== "from_name") return null;
  return (
    <Collapsible open={alwaysExpanded || advanced} onOpenChange={setAdvanced} disabled={disabled}>
      {!alwaysExpanded ? (
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="group -ml-2"
          >
            <ChevronRight
              data-icon="inline-start"
              className="transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
            />
            Advanced
          </Button>
        </CollapsibleTrigger>
      ) : null}
      <CollapsibleContent className="pt-2">
        <div className="grid gap-1.5" data-invalid={branchError || undefined}>
          <Label htmlFor="workspace-session-branch-name">
            Branch name <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Input
            id="workspace-session-branch-name"
            value={value.branchName ?? ""}
            onChange={(event) => onChange({ ...value, branchName: event.target.value || null })}
            placeholder={defaultBranch || "feature/my-feature"}
            autoComplete="off"
            disabled={disabled}
            aria-invalid={branchError || error?.field === "worktree.branchName"}
            aria-describedby={
              error?.field === "worktree.branchName" ? "workspace-session-branch-error" : undefined
            }
          />
          {branchError && <p className="text-xs text-destructive">{INVALID_BRANCH_NAME}</p>}
        </div>
      </CollapsibleContent>
      <NewBranchPreview
        branch={value.branchName || defaultBranch}
        namedByFirstMessage={branchNamedByFirstMessage(value, hasNamingModel)}
      />
      <WorktreeBranchValidation message={branchFailure} />
      {config.isError && (
        <div role="alert">
          <p className="text-sm text-destructive">{errorMessage(config.error)}</p>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => void config.refetch()}
          >
            Retry branch settings
          </Button>
        </div>
      )}
    </Collapsible>
  );
}
