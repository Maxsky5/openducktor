import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { Folder, FolderGit2, GitBranch, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { WorkspaceSessionModelFields } from "./workspace-session-model-fields";
import {
  NO_CUSTOM_AGENT_ROLE,
  useWorkspaceSessionCreate,
  useWorkspaceSessionCreateDefaults,
} from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
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
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useWorkspaceSessionCreateModelPicker } from "./use-workspace-session-model-picker";
import { WorkspaceSessionExistingWorktreeField } from "./workspace-session-existing-worktree-field";
import { WorkspaceSessionTargetBranchField } from "./workspace-session-target-branch-field";
import { WorkspaceSessionWorktreeFields } from "./workspace-session-worktree-fields";
import { WorkspaceSessionWorkLocationField } from "./workspace-session-work-location-field";
import { StartupDialogProgress } from "@/features/session-startup/session-startup-dialog-progress";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useStartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { startupTraceRows } from "@openducktor/frontend-core/sessions/startup/startup-trace";
import { cn } from "@/lib/utils";

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
  const connection = useClientConnection();
  const { repoConfig, defaultModelSelection } = useWorkspaceSessionCreateDefaults(
    workspace.workspaceId,
  );
  const model = useWorkspaceSessionCreateModelPicker(workspace.repoPath, defaultModelSelection);
  const form = useWorkspaceSessionCreate({
    workspace,
    model: {
      selection: model.selection,
      selectedModelAvailable: Boolean(model.selectedModelEntry),
    },
    open,
    onCreated: (record, attemptId) => {
      onCreated(record);
      connection.startupAttempts.handoff(attemptId);
    },
  });
  const { create, startupAttemptId, editChoices, dismissStartup } = form;
  const attempt = useStartupAttempt(startupAttemptId);
  const hasTrace = attempt !== null && startupTraceRows(attempt).length > 0;
  const starting = create.isPending || startupIsPending(attempt);
  const close = () => {
    if (
      !startupAttemptId ||
      connection.startupAttempts.getAttempt(startupAttemptId)?.presentation === "dialog"
    )
      dismissStartup();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !starting) close();
      }}
    >
      <DialogContent
        className={cn(
          "my-0 gap-0 p-0 sm:max-w-2xl",
          startupAttemptId && "max-w-lg overflow-hidden sm:max-w-lg",
          hasTrace && "min-h-[min(18rem,calc(100dvh-2rem))] max-h-[min(30rem,calc(100dvh-2rem))]",
        )}
        closeButton={starting ? null : undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (starting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (starting) event.preventDefault();
        }}
      >
        <DialogHeader
          className={cn("border-b border-border px-6 py-4", startupAttemptId && "px-4 py-3")}
        >
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription className={cn(startupAttemptId && "sr-only")}>
            {startupAttemptId
              ? "Follow session startup progress."
              : "Choose where the agent works and how it starts."}
          </DialogDescription>
        </DialogHeader>
        {startupAttemptId ? (
          <StartupDialogProgress
            open={open}
            startupAttemptId={startupAttemptId}
            onClose={close}
            onEditChoices={editChoices}
            onRepairSavedSession={form.repairSavedSession}
          />
        ) : (
          <WorkspaceSessionCreateForm
            form={form}
            model={model}
            repoConfig={repoConfig}
            workspace={workspace}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceSessionCreateForm({
  form,
  model,
  repoConfig,
  workspace,
  onClose,
}: {
  form: ReturnType<typeof useWorkspaceSessionCreate>;
  model: ReturnType<typeof useWorkspaceSessionCreateModelPicker>;
  repoConfig: ReturnType<typeof useWorkspaceSessionCreateDefaults>["repoConfig"];
  workspace: ActiveWorkspace;
  onClose: () => void;
}): ReactElement {
  const {
    name,
    setName,
    roleId,
    setRoleId,
    location,
    selectLocation,
    worktree,
    changeWorktree,
    existing,
    selectExistingWorktree,
    targetBranch,
    defaultTarget,
    pickTarget,
    roles,
    branches,
    create,
    worktreeError,
    input,
    submit,
  } = form;
  return (
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
                  { value: NO_CUSTOM_AGENT_ROLE, label: "No role" },
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
            onValueChange={selectLocation}
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
              {
                value: "existing_worktree",
                label: "Existing worktree",
                description: "Use a worktree that already exists.",
                icon: FolderGit2,
              },
            ]}
          />
          {location === "existing_worktree" && (
            <WorkspaceSessionExistingWorktreeField
              choice={existing}
              disabled={create.isPending}
              onChange={selectExistingWorktree}
            />
          )}
          <WorkspaceSessionTargetBranchField
            value={targetBranch}
            defaultTarget={defaultTarget}
            allowUpstream={location === "local_repo_root"}
            branches={branches}
            disabled={create.isPending}
            onChange={pickTarget}
          />
          {location === "local_worktree" && (
            <WorkspaceSessionWorktreeFields
              workspace={workspace}
              value={worktree}
              disabled={create.isPending}
              branches={branches}
              error={worktreeError}
              onChange={changeWorktree}
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
  );
}
