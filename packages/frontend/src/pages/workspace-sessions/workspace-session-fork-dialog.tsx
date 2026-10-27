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
import { StartupDialogProgress } from "@/features/session-startup/session-startup-dialog-progress";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useStartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { useWorkspaceForkHandoff } from "./use-workspace-fork-handoff";
import { cn } from "@/lib/utils";

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
  const connection = useClientConnection();
  const store = useAgentSessionsContext();
  const config = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const [destination, setDestination] = useState<WorkspaceSessionForkDestination>("same_folder");
  const [worktree, setWorktree] = useState<WorkspaceSessionWorktreeInput>(() =>
    initialForkWorktree(record),
  );
  const [failure, setFailure] = useState<Error | null>(null);
  const [startupAttemptId, setStartupAttemptId] = useState<string | null>(null);
  const attempt = useStartupAttempt(startupAttemptId);
  const observeHandoff = useWorkspaceForkHandoff({
    workspace,
    sourceSessionId: record.id,
    open,
    onForked,
  });
  const starting = pending || startupIsPending(attempt);
  const worktreeError = workspaceSessionValidationError(failure);
  const formError = worktreeError ? null : failure;
  const { name: folderName, directory } = forkSourceFolder(record);
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
    if (starting || disabledReason || !input) return;
    setFailure(null);
    void forkWorkspaceSession(queryClient, store, workspace.repoPath, source, input, {
      presentation: "dialog",
      onAttempt: (id) => {
        setStartupAttemptId(id);
        observeHandoff(id);
      },
    }).catch((cause: unknown) => {
      setFailure(cause instanceof Error ? cause : new Error(errorMessage(cause)));
    });
  };
  const close = () => {
    if (
      startupAttemptId &&
      connection.startupAttempts.getAttempt(startupAttemptId)?.presentation === "dialog"
    )
      connection.startupAttempts.dismiss(startupAttemptId);
    onClose();
  };
  const editChoices = () => {
    if (startupAttemptId) connection.startupAttempts.dismiss(startupAttemptId);
    setStartupAttemptId(null);
    setFailure(null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !starting) close();
      }}
    >
      <DialogContent
        className={cn(
          "my-0 gap-0 p-0 sm:max-w-2xl",
          startupAttemptId &&
            "min-h-[min(18rem,calc(100dvh-2rem))] max-h-[min(30rem,calc(100dvh-2rem))] max-w-lg overflow-hidden sm:max-w-lg",
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
          <DialogTitle>{FORK_CHAT_TEXT.title}</DialogTitle>
          <DialogDescription className={cn(startupAttemptId && "sr-only")}>
            {startupAttemptId ? "Follow session startup progress." : FORK_CHAT_TEXT.description}
          </DialogDescription>
        </DialogHeader>
        {startupAttemptId ? (
          <StartupDialogProgress
            open={open}
            startupAttemptId={startupAttemptId}
            onClose={close}
            onEditChoices={editChoices}
          />
        ) : (
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
              <ForkFooter
                pending={pending}
                error={formError}
                disabledReason={disabledReason}
                canSubmit={input !== null}
                onClose={close}
              />
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ForkFooter({
  pending,
  error,
  disabledReason,
  canSubmit,
  onClose,
}: {
  pending: boolean;
  error: Error | null;
  disabledReason: string | null;
  canSubmit: boolean;
  onClose: () => void;
}): ReactElement {
  return (
    <DialogFooter className="mt-0 flex-col border-t border-border px-6 py-4">
      {error ? (
        <p role="alert" className="break-words text-sm text-destructive">
          {error.message}
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
        <Button type="submit" disabled={pending || disabledReason !== null || !canSubmit}>
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          {pending ? FORK_CHAT_TEXT.confirming : FORK_CHAT_TEXT.confirm}
        </Button>
      </div>
    </DialogFooter>
  );
}
