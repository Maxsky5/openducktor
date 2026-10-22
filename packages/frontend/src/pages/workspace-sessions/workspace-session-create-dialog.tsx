import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  type WorkspaceSession,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionWorktreeInput,
} from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, GitBranch, LoaderCircle } from "lucide-react";
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
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  invalidateRepoBranchesQuery,
  repoBranchesQueryOptions,
} from "@openducktor/frontend-core/queries/git";
import {
  customAgentRolesQueryOptions,
  updateWorkspaceSessionQueries,
} from "@openducktor/frontend-core/queries/workspace-sessions";
import { invalidateTerminalList } from "@openducktor/frontend-core/queries/terminals";
import {
  repoConfigQueryOptions,
  toRepoSettingsInput,
} from "@openducktor/frontend-core/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";
import { useMountedRef } from "./use-mounted-ref";
import {
  useWorkspaceSessionLocationTarget,
  WorkspaceSessionTargetBranchField,
} from "./workspace-session-target-branch-field";
import { WorkspaceSessionWorktreeFields } from "./workspace-session-worktree-fields";
import { WorkspaceSessionWorkLocationField } from "./workspace-session-work-location-field";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

type WorkspaceSessionCreateDialogProps = {
  open?: boolean;
  workspace: ActiveWorkspace;
  onClose: () => void;
  onCreated: (session: WorkspaceSession) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

export function WorkspaceSessionCreateDialog({
  open = true,
  workspace,
  onClose,
  onCreated,
  onCloseAutoFocus,
}: WorkspaceSessionCreateDialogProps): ReactElement {
  const host = useHostClient();
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
  const [worktree, setWorktree] = useState<WorkspaceSessionWorktreeInput>({
    mode: "from_name",
    name: "",
    branchName: null,
  });
  const defaultTarget = repoConfig.data?.defaultTargetBranch ?? null;
  const { location, targetBranch, changeLocation, pickTarget } =
    useWorkspaceSessionLocationTarget(defaultTarget);
  const branches = useQuery({ ...repoBranchesQueryOptions(workspace.repoPath), enabled: open });
  const mounted = useMountedRef();
  const create = useMutation({
    mutationFn: (input: WorkspaceSessionCreateInput) => host.workspaceSessionCreate(input),
    onSuccess: (result, input) => {
      updateWorkspaceSessionQueries(queryClient, input.workspaceId, result.session);
      void invalidateTerminalList(queryClient, {
        kind: "workspace_session",
        workspaceId: input.workspaceId,
        sessionId: result.session.id,
      });
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
    targetBranch,
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
      open={open}
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent className="my-0 gap-0 p-0 sm:max-w-2xl" onCloseAutoFocus={onCloseAutoFocus}>
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
              {repoConfig.isError && (
                <div role="alert">
                  <p className="text-sm text-destructive">
                    The repository Default Model and default target branch could not load.{" "}
                    {errorMessage(repoConfig.error)}
                  </p>
                  <Button type="button" variant="ghost" onClick={() => void repoConfig.refetch()}>
                    Retry repository defaults
                  </Button>
                </div>
              )}
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
              <WorkspaceSessionWorkLocationField
                value={location}
                onValueChange={(value) => {
                  create.reset();
                  changeLocation(value);
                }}
                disabled={create.isPending}
                options={[
                  {
                    value: "local_repo_root",
                    label: "Current checkout",
                    description: "Work with the files already here.",
                    icon: Folder,
                  },
                  {
                    value: "local_worktree",
                    label: "New worktree",
                    description: "Use an isolated directory and branch.",
                    icon: GitBranch,
                  },
                ]}
              />
              <WorkspaceSessionTargetBranchField
                value={targetBranch}
                defaultTarget={defaultTarget}
                allowUpstream={location === "local_repo_root"}
                branches={branches}
                disabled={create.isPending}
                onChange={(value) => {
                  create.reset();
                  pickTarget(value);
                }}
              />
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
            <DialogFooter className="mt-0 justify-between border-t border-border px-6 py-4 sm:justify-between">
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
