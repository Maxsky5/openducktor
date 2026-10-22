import { newWorktreeBranchState } from "./workspace-session-new-worktree-branch";
import {
  type AgentSessionForkPoint,
  type WorkspaceSession,
  type WorkspaceSessionForkInput,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionForkInputSchema,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, GitBranch, LoaderCircle } from "lucide-react";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { forkWorkspaceSession } from "@openducktor/frontend-core/sessions/session-forks";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { workspaceSessionValidationError } from "./workspace-session-create-input";
import { NewWorktreeBranchFields, WorktreeNameField } from "./workspace-session-worktree-inputs";
import { WorkspaceSessionWorkLocationField } from "./workspace-session-work-location-field";

export function WorkspaceSessionForkDialog({
  open,
  workspace,
  record,
  source,
  point,
  disabledReason,
  pending,
  onClose,
  onForked,
  onCloseAutoFocus,
}: {
  open: boolean;
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  source: AgentSessionIdentity;
  point: AgentSessionForkPoint;
  disabledReason: string | null;
  pending: boolean;
  onClose: () => void;
  onForked: (record: WorkspaceSession) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const store = useAgentSessionsContext();
  const config = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const [destination, setDestination] =
    useState<WorkspaceSessionForkInput["destination"]["kind"]>("same_folder");
  const [worktree, setWorktree] = useState<WorkspaceSessionWorktreeInput>(() => ({
    mode: "from_name",
    name:
      record.executionTarget.kind === "local_worktree"
        ? `${record.executionTarget.workingDirectory.split(/[/\\]/).at(-1) ?? ""}-fork`
        : "",
    branchName: null,
  }));
  const [failure, setFailure] = useState<Error | null>(null);
  const worktreeError = workspaceSessionValidationError(failure);
  const branch = newWorktreeBranchState(worktree, config.data?.branchPrefix);
  const parsed = workspaceSessionForkInputSchema.safeParse({
    workspaceId: workspace.workspaceId,
    sessionId: record.id,
    forkPoint: point,
    destination:
      destination === "same_folder"
        ? { kind: "same_folder" }
        : {
            kind: "new_worktree",
            name: worktree.name,
            branchName: worktree.branchName || branch.defaultBranch,
          },
  });
  const changeWorktree = (value: WorkspaceSessionWorktreeInput): void => {
    setFailure(null);
    setWorktree(value);
  };
  const submit = () => {
    if (pending || disabledReason || !parsed.success) return;
    setFailure(null);
    void forkWorkspaceSession(queryClient, store, workspace.repoPath, source, parsed.data)
      .then((result) => {
        if (result.syncWarning)
          toast.warning("The fork was created", { description: result.syncWarning });
        onForked(result.record);
      })
      .catch((cause: unknown) => {
        setFailure(cause instanceof Error ? cause : new Error(errorMessage(cause)));
      });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <DialogContent
        className="my-0 gap-0 p-0 sm:max-w-2xl"
        closeButton={pending ? null : undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Fork chat</DialogTitle>
          <DialogDescription>
            Copy the conversation through this reply, then choose where the new chat works.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={pending} className="contents">
            <DialogBody className="flex flex-col gap-4 px-6 py-4">
              <WorkspaceSessionWorkLocationField
                value={destination}
                onValueChange={setDestination}
                disabled={pending}
                ariaLabel="Fork work location"
                options={[
                  {
                    value: "same_folder",
                    label: "Same folder",
                    description: "Work with the files already here.",
                    icon: Folder,
                  },
                  {
                    value: "new_worktree",
                    label: "New worktree",
                    description: "Start from the last commit in the source folder.",
                    icon: GitBranch,
                  },
                ]}
              />
              <div className="grid gap-1">
                <p className="text-sm font-medium">Source folder</p>
                <p className="break-all font-mono text-xs text-muted-foreground dark:text-foreground/80">
                  {record.executionTarget.workingDirectory}
                </p>
                {record.executionTarget.kind === "local_worktree" &&
                record.executionTarget.branchName ? (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground dark:text-foreground/80">
                    <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="break-all">{record.executionTarget.branchName}</span>
                  </p>
                ) : null}
              </div>
              {destination === "new_worktree" ? (
                <div className="flex flex-col gap-3">
                  <WorktreeNameField
                    value={worktree}
                    onChange={changeWorktree}
                    disabled={pending}
                    error={worktreeError}
                  />
                  <NewWorktreeBranchFields
                    workspace={workspace}
                    value={worktree}
                    onChange={changeWorktree}
                    disabled={pending}
                    error={worktreeError}
                    alwaysExpanded
                  />
                  <p className="text-sm text-muted-foreground">
                    Uncommitted changes in the source folder do not go to the new worktree.
                  </p>
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter className="mt-0 flex-col border-t border-border px-6 py-4">
              {failure && !worktreeError ? (
                <p role="alert" className="break-words text-sm text-destructive">
                  {failure.message}
                </p>
              ) : null}
              {disabledReason ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {disabledReason}
                </p>
              ) : null}
              <div className="flex justify-between gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={pending || disabledReason !== null || !parsed.success}
                >
                  {pending ? <LoaderCircle className="animate-spin" /> : null}
                  {pending ? "Forking chat…" : "Fork chat"}
                </Button>
              </div>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
