import type {
  AgentSessionForkPoint,
  WorkspaceSession,
  WorkspaceSessionWorktreeInput,
} from "@openducktor/contracts";
import {
  FORK_CHAT_TEXT,
  forkSourceFolder,
  initialForkWorktree,
  type WorkspaceSessionForkDestination,
  workspaceSessionForkInput,
} from "@openducktor/frontend-core/workspace-sessions/fork/workspace-session-fork-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, GitBranch, LoaderCircle } from "lucide-react";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { workspaceSessionValidationError } from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-create-input";
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
  const { name: folderName, directory } = forkSourceFolder(record);
  const [destination, setDestination] = useState<WorkspaceSessionForkDestination>("same_folder");
  const [worktree, setWorktree] = useState<WorkspaceSessionWorktreeInput>(() =>
    initialForkWorktree(record),
  );
  const [failure, setFailure] = useState<Error | null>(null);
  const worktreeError = workspaceSessionValidationError(failure);
  const input = workspaceSessionForkInput({
    workspaceId: workspace.workspaceId,
    record,
    point,
    destination,
    worktree,
    branchPrefix: config.data?.branchPrefix,
  });
  const changeWorktree = (value: WorkspaceSessionWorktreeInput): void => {
    setFailure(null);
    setWorktree(value);
  };
  const submit = () => {
    if (pending || disabledReason || !input) return;
    setFailure(null);
    void forkWorkspaceSession(queryClient, store, workspace.repoPath, source, input)
      .then((result) => {
        if (result.syncWarning)
          toast.warning(FORK_CHAT_TEXT.forkedWithWarning, { description: result.syncWarning });
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
          <DialogTitle>{FORK_CHAT_TEXT.title}</DialogTitle>
          <DialogDescription>{FORK_CHAT_TEXT.description}</DialogDescription>
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
                ariaLabel={FORK_CHAT_TEXT.locationLabel}
                options={[
                  {
                    value: "same_folder",
                    label: FORK_CHAT_TEXT.sameFolder,
                    description: FORK_CHAT_TEXT.sameFolderDescription,
                    icon: Folder,
                  },
                  {
                    value: "new_worktree",
                    label: FORK_CHAT_TEXT.newWorktree,
                    description: FORK_CHAT_TEXT.newWorktreeDescription,
                    icon: GitBranch,
                  },
                ]}
              />
              <div className="min-w-0 rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {FORK_CHAT_TEXT.sourceFolder}
                </p>
                <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Folder aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 break-words">{folderName}</span>
                  </p>
                  {record.executionTarget.kind === "local_worktree" &&
                  record.executionTarget.branchName ? (
                    <Badge
                      variant="outline"
                      className="max-w-full gap-1.5 self-start font-mono font-normal"
                    >
                      <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="sr-only">Source branch: </span>
                      <span className="min-w-0 break-words">
                        {record.executionTarget.branchName}
                      </span>
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 break-words font-mono text-xs leading-relaxed text-muted-foreground dark:text-foreground/80">
                  {directory}
                </p>
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
                    {FORK_CHAT_TEXT.uncommittedChanges}
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
                <Button type="submit" disabled={pending || disabledReason !== null || !input}>
                  {pending ? <LoaderCircle className="animate-spin" /> : null}
                  {pending ? FORK_CHAT_TEXT.confirming : FORK_CHAT_TEXT.confirm}
                </Button>
              </div>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
