import type { RepoConfig, WorkspaceSessionWorktreeInput } from "@openducktor/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  INVALID_BRANCH_NAME,
  newWorktreeBranchState,
  WORKTREE_NAME_MAX_LENGTH,
  worktreeDirectoryName,
  worktreeNameError,
  type WorkspaceSessionWorktreeFieldError,
} from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";

type WorktreeInputProps = {
  value: WorkspaceSessionWorktreeInput;
  onChange: (value: WorkspaceSessionWorktreeInput) => void;
  disabled: boolean;
  error: WorkspaceSessionWorktreeFieldError | null;
};

export function WorktreeNameField({
  value,
  onChange,
  disabled,
  error,
}: WorktreeInputProps): ReactElement {
  const directoryName = worktreeDirectoryName(value.name);
  const nameError = worktreeNameError(value.name, error);

  return (
    <div className="grid gap-1.5" data-invalid={Boolean(nameError) || undefined}>
      <Label htmlFor="workspace-session-worktree-name">Worktree name</Label>
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

export function NewWorktreeBranchFields({
  config,
  value,
  onChange,
  disabled,
  error,
}: WorktreeInputProps & { config: UseQueryResult<RepoConfig> }): ReactElement {
  const { branchError, defaultBranch } = newWorktreeBranchState(value, config.data?.branchPrefix);

  const branchFailure = error?.field === "worktree.branchName" ? error.message : null;
  const previewBranch = value.branchName || defaultBranch;
  return (
    <div className="grid gap-1.5">
      <div className="grid gap-1.5" data-invalid={branchError || undefined}>
        <Label htmlFor="workspace-session-branch-name">
          Branch name <span className="font-normal text-muted-foreground">optional</span>
        </Label>
        <Input
          id="workspace-session-branch-name"
          value={value.branchName ?? ""}
          onChange={(event) =>
            onChange({
              mode: "from_name",
              name: value.name,
              branchName: event.target.value || null,
            })
          }
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
      {previewBranch ? (
        <p className="break-all text-xs text-muted-foreground">
          New branch: <span className="font-mono">{previewBranch}</span>
        </p>
      ) : null}
      {branchFailure ? (
        <p
          id="workspace-session-branch-error"
          role="alert"
          className="break-words text-sm text-destructive"
        >
          {branchFailure}
        </p>
      ) : null}
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
    </div>
  );
}
