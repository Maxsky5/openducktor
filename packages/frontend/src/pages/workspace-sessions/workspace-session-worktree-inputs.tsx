import {
  type WorkspaceSessionWorktreeInput,
  type HostInvokeFailure,
  type GitBranch,
  workspaceSessionBranchNameSchema,
  workspaceSessionWorktreeNameSchema,
} from "@openducktor/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";

export type WorktreeInputProps = {
  value: WorkspaceSessionWorktreeInput;
  onChange: (value: WorkspaceSessionWorktreeInput) => void;
  disabled: boolean;
  error: {
    field: Extract<HostInvokeFailure, { kind: "workspace_session_validation" }>["field"];
    message: string;
  } | null;
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
  const localBranches = (branches.data ?? []).filter((branch) => !branch.isRemote);
  const branchOptions = toBranchSelectorOptions(localBranches).map((option, index) => {
    const branch = localBranches[index];
    return branch?.worktreePath
      ? { ...option, disabled: true, description: `Already checked out at ${branch.worktreePath}` }
      : option;
  });
  const selectedWorktree =
    value.mode === "from_branch"
      ? localBranches.find((branch) => branch.name === value.branchName)?.worktreePath
      : undefined;
  const branchFailure =
    error?.field === "worktree.branchName"
      ? error.message
      : selectedWorktree
        ? `This branch is already checked out at ${selectedWorktree}. Choose another branch or use Current checkout.`
        : null;

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
        onValueChange={(branchName) => {
          const name =
            value.name ||
            branchName
              .replace(/[^a-zA-Z0-9_-]+/g, "-")
              .replace(/^-+/, "")
              .slice(0, 80);
          onChange({ mode: "from_branch", name, branchName });
        }}
      />
      <p id="workspace-session-existing-branch-hint" className="text-xs text-muted-foreground">
        Uses this branch directly. It must not be checked out elsewhere.
      </p>
      <WorktreeBranchValidation message={branchFailure} />
    </div>
  );
}

export function WorktreeNameField({ value, onChange, disabled, error }: WorktreeInputProps) {
  const parsedName = workspaceSessionWorktreeNameSchema.safeParse(value.name);
  const nameError =
    error?.field === "worktree.name"
      ? error.message
      : value.name.length > 0 && !parsedName.success
        ? "Use letters, numbers, hyphens, or underscores, starting with a letter or number. Names must be at most 80 characters."
        : null;

  return (
    <div className="grid gap-1.5" data-invalid={Boolean(nameError) || undefined}>
      <Label htmlFor="workspace-session-worktree-name">Worktree name</Label>
      <Input
        id="workspace-session-worktree-name"
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
        placeholder="my-feature"
        autoComplete="off"
        maxLength={80}
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
      {parsedName.success && (
        <p className="break-all text-xs text-muted-foreground">
          Directory: <span className="font-mono">{parsedName.data}</span>
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

function newWorktreeBranchState(
  value: WorkspaceSessionWorktreeInput,
  branchPrefix: string | undefined,
) {
  const parsedName = workspaceSessionWorktreeNameSchema.safeParse(value.name);
  const branchError =
    value.branchName !== null &&
    value.branchName.length > 0 &&
    !workspaceSessionBranchNameSchema.safeParse(value.branchName).success;
  const defaultBranch =
    branchPrefix !== undefined && parsedName.success ? `${branchPrefix}/${parsedName.data}` : "";
  return { branchError, defaultBranch };
}

export function NewWorktreeBranchFields({
  workspace,
  value,
  onChange,
  disabled,
  error,
}: WorktreeInputProps & { workspace: ActiveWorkspace }) {
  const [advanced, setAdvanced] = useState(false);
  const config = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const { branchError, defaultBranch } = newWorktreeBranchState(value, config.data?.branchPrefix);

  const branchFailure = error?.field === "worktree.branchName" ? error.message : null;
  if (value.mode !== "from_name") return null;
  return (
    <Collapsible open={advanced} onOpenChange={setAdvanced} disabled={disabled}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="group -ml-2">
          <ChevronRight
            data-icon="inline-start"
            className="transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
          />
          Advanced
        </Button>
      </CollapsibleTrigger>
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
          {branchError && (
            <p className="text-xs text-destructive">Enter a valid Git branch name.</p>
          )}
        </div>
      </CollapsibleContent>
      {(value.branchName || defaultBranch) && (
        <p className="mt-1 break-all text-xs text-muted-foreground">
          New branch: <span className="font-mono">{value.branchName || defaultBranch}</span>
        </p>
      )}
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
