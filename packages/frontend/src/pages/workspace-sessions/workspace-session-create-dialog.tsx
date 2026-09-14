import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  type WorkspaceSession,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionWorktreeInput,
} from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Folder, GitBranch, LoaderCircle } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { WorkspaceSessionModelFields } from "./workspace-session-model-fields";
import {
  buildWorkspaceSessionCreateInput,
  workspaceSessionValidationError,
} from "./workspace-session-create-input";
import { SettingsModal } from "@/components/features/settings/settings-modal";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { repoDefaultModelSelectionFor } from "@/features/session-start/session-start-selection";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { host } from "@/state/operations/host";
import { invalidateRepoBranchesQuery, repoBranchesQueryOptions } from "@/state/queries/git";
import {
  customAgentRolesQueryOptions,
  updateWorkspaceSessionQueries,
} from "@/state/queries/workspace-sessions";
import { repoConfigQueryOptions, toRepoSettingsInput } from "@/state/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";
import { useMountedRef } from "./use-mounted-ref";
import { WorkspaceSessionWorktreeFields } from "./workspace-session-worktree-fields";

type WorkspaceSessionCreateDialogProps = {
  workspace: ActiveWorkspace;
  onClose: () => void;
  onCreated: (session: WorkspaceSession) => void;
};

export function WorkspaceSessionCreateDialog({
  workspace,
  onClose,
  onCreated,
}: WorkspaceSessionCreateDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const roles = useQuery(customAgentRolesQueryOptions());
  const repoConfig = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const defaultModelSelection = useMemo(
    () =>
      repoConfig.data ? repoDefaultModelSelectionFor(toRepoSettingsInput(repoConfig.data)) : null,
    [repoConfig.data],
  );
  const model = useWorkspaceSessionModelPicker(
    workspace.repoPath,
    undefined,
    defaultModelSelection,
  );
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("none");
  const [location, setLocation] =
    useState<WorkspaceSessionCreateInput["location"]>("local_repo_root");
  const [worktree, setWorktree] = useState<WorkspaceSessionWorktreeInput>({
    mode: "from_name",
    name: "",
    branchName: null,
  });
  const branches = useQuery({
    ...repoBranchesQueryOptions(workspace.repoPath),
    enabled: location === "local_worktree" && worktree.mode === "from_branch",
  });
  const mounted = useMountedRef();
  const create = useMutation({
    mutationFn: (input: WorkspaceSessionCreateInput) => host.workspaceSessionCreate(input),
    onSuccess: (result, input) => {
      updateWorkspaceSessionQueries(queryClient, input.workspaceId, result.session);
      if (input.location === "local_worktree")
        void invalidateRepoBranchesQuery(queryClient, workspace.repoPath);
      if (mounted.current) onCreated(result.session);
    },
    onError: (error) => {
      if (workspaceSessionValidationError(error))
        void invalidateRepoBranchesQuery(queryClient, workspace.repoPath);
    },
  });
  const worktreeError = workspaceSessionValidationError(create.error);
  const input = buildWorkspaceSessionCreateInput({
    workspaceId: workspace.workspaceId,
    name,
    roleId,
    location,
    worktree,
    selection: model.selection,
    selectedModelAvailable: Boolean(model.selectedModelEntry),
    rolesReady: roles.isSuccess,
    availableBranches: branches.isSuccess ? branches.data : null,
  });
  const submit = () => {
    if (!create.isPending && input) create.mutate(input);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent className="my-0 gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>Choose where the agent works and how it starts.</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={create.isPending} className="contents">
            <DialogBody className="flex flex-col gap-3 px-6 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="workspace-session-name">
                  Name <span className="font-normal text-muted-foreground">optional</span>
                </Label>
                <Input
                  id="workspace-session-name"
                  autoComplete="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="What are you working on?"
                  maxLength={WORKSPACE_SESSION_MANUAL_TITLE_LIMIT}
                />
              </div>
              <WorkspaceSessionModelFields model={model} disabled={create.isPending} />
              <div className="grid gap-1.5">
                <Label id="workspace-session-role">
                  Custom role <span className="font-normal text-muted-foreground">optional</span>
                </Label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <Combobox
                    triggerAriaLabelledBy="workspace-session-role"
                    value={roleId}
                    onValueChange={setRoleId}
                    disabled={create.isPending || roles.isPending || roles.isError}
                    options={[
                      { value: "none", label: "No role" },
                      ...(roles.data ?? []).map((role) => ({ value: role.id, label: role.name })),
                    ]}
                  />
                  <SettingsModal
                    triggerLabel="Manage roles"
                    triggerSize="default"
                    deepLink={{ kind: "custom-agent-roles" }}
                  />
                </div>
                {roles.isError && (
                  <div role="alert">
                    <p className="text-sm text-destructive">{errorMessage(roles.error)}</p>
                    <Button type="button" variant="ghost" onClick={() => void roles.refetch()}>
                      Retry roles
                    </Button>
                  </div>
                )}
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Work location</legend>
                <div
                  role="radiogroup"
                  aria-label="Work location"
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  {(
                    [
                      {
                        kind: "local_repo_root",
                        label: "Current checkout",
                        description: "Work with the files already here.",
                        icon: Folder,
                      },
                      {
                        kind: "local_worktree",
                        label: "New worktree",
                        description: "Use an isolated directory and branch.",
                        icon: GitBranch,
                      },
                    ] as const
                  ).map((target) => (
                    <Button
                      key={target.kind}
                      type="button"
                      role="radio"
                      aria-checked={location === target.kind}
                      variant="outline"
                      onClick={() => {
                        create.reset();
                        setLocation(target.kind);
                      }}
                      className={cn(
                        "h-auto items-start justify-start gap-3 whitespace-normal p-3 text-left",
                        location === target.kind && "border-primary bg-accent",
                      )}
                    >
                      <target.icon />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span>{target.label}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {target.description}
                        </span>
                      </span>
                      {location === target.kind && <Check />}
                    </Button>
                  ))}
                </div>
              </fieldset>
              {location === "local_worktree" && (
                <WorkspaceSessionWorktreeFields
                  workspace={workspace}
                  value={worktree}
                  disabled={create.isPending}
                  branches={branches}
                  error={worktreeError}
                  onChange={(value) => {
                    create.reset();
                    setWorktree(value);
                  }}
                />
              )}
              {create.error && !worktreeError && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(create.error)}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="mt-0 justify-between border-t border-border bg-muted/30 px-6 py-4 sm:justify-between">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || input === null}>
                {create.isPending && <LoaderCircle className="animate-spin" />}
                {create.isPending ? "Creating chat…" : "Create chat"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
