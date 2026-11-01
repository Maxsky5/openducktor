import type {
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
  WorkspaceSessionArchivePreview,
} from "@openducktor/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Archive, ChevronDown, FolderGit2, LoaderCircle } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SwitchCard } from "@/components/ui/switch-card";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { workspaceSessionArchivePreviewQueryOptions } from "@openducktor/frontend-core/queries/workspace-session-archive";
import {
  ARCHIVE_CHAT_TEXT,
  canArchiveWorkspaceSession,
  effectiveWorktreeRemoval,
  isWorktreeChat,
  sharedWorktreeNotice,
  taskWorktreeNotice,
  worktreeArchiveConfirmation,
  worktreeArchiveNotice,
} from "@openducktor/frontend-core/workspace-sessions/workspace-session-archive-plan";
import { WorktreeArchivePreview } from "./worktree-archive-preview";

type Props = {
  open: boolean;
  workspaceId: string;
  record: WorkspaceSession;
  isArchiving: boolean;
  error: Error | null;
  onArchive: (
    removeWorktree: boolean,
    confirmation?: WorkspaceSessionArchiveInput["worktreeConfirmation"],
  ) => void;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
};

export function WorkspaceSessionArchiveDialog({ record, ...props }: Props): ReactElement {
  if (isWorktreeChat(record)) {
    return <WorktreeArchiveDialog record={record} {...props} />;
  }
  return (
    <ArchiveDialog
      {...props}
      record={record}
      onConfirm={() => props.onArchive(false)}
      canArchive={!props.isArchiving}
    >
      <p className="text-sm text-muted-foreground">{ARCHIVE_CHAT_TEXT.repositoryFilesStay}</p>
    </ArchiveDialog>
  );
}

function WorktreeArchiveDialog({ workspaceId, record, ...props }: Props): ReactElement {
  const [wantsWorktreeRemoval, setWantsWorktreeRemoval] = useState(true);
  const preview = useQuery({
    ...workspaceSessionArchivePreviewQueryOptions(workspaceId, record.id),
    enabled: props.open,
  });
  const isChecking = preview.isFetching;
  const removeWorktree = effectiveWorktreeRemoval(wantsWorktreeRemoval, preview);
  const sharedNotice = sharedWorktreeNotice(preview);
  const taskNotice = taskWorktreeNotice(preview);
  const canArchive = canArchiveWorkspaceSession({
    record,
    removeWorktree,
    preview,
    isArchiving: props.isArchiving,
    checking: isChecking,
  });
  return (
    <ArchiveDialog
      {...props}
      record={record}
      canArchive={canArchive}
      loading={isChecking && preview.data === undefined && !props.isArchiving}
      removeWorktree={removeWorktree}
      onConfirm={() =>
        props.onArchive(
          removeWorktree,
          worktreeArchiveConfirmation(record, removeWorktree, preview),
        )
      }
    >
      {isChecking && (
        <p role="status" className="text-sm text-muted-foreground">
          {ARCHIVE_CHAT_TEXT.checkingWorktree}
        </p>
      )}
      <SwitchCard
        icon={FolderGit2}
        label={ARCHIVE_CHAT_TEXT.removeWorktree}
        checked={removeWorktree}
        onCheckedChange={setWantsWorktreeRemoval}
        disabled={props.isArchiving || sharedNotice !== null || taskNotice !== null}
      >
        {sharedNotice && <p className="text-sm text-muted-foreground">{sharedNotice}</p>}
        {taskNotice && <p className="text-sm text-muted-foreground">{taskNotice}</p>}
        <ArchiveWorktreeNotice removeWorktree={removeWorktree} preview={preview} />
        <WorktreeArchivePreview preview={preview} removeWorktree={removeWorktree} />
      </SwitchCard>
    </ArchiveDialog>
  );
}

function ArchiveDialog({
  open,
  record,
  isArchiving,
  error,
  onClose,
  onCloseAutoFocus,
  onConfirm,
  canArchive,
  removeWorktree = false,
  loading = false,
  children,
}: Omit<Props, "workspaceId" | "onArchive"> & {
  onConfirm: () => void;
  canArchive: boolean;
  removeWorktree?: boolean;
  loading?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isArchiving) onClose();
      }}
    >
      <DialogContent
        loading={loading}
        loadingLabel="Loading worktree details…"
        className="p-0 sm:max-w-lg"
        closeButton={isArchiving ? null : undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (canArchive) onConfirm();
          }}
        >
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle>{ARCHIVE_CHAT_TEXT.title}</DialogTitle>
            <DialogDescription>{ARCHIVE_CHAT_TEXT.description}</DialogDescription>
            <div className="flex min-w-0 items-center gap-2 pt-2 text-sm font-medium">
              <AgentRuntimeIcon runtimeKind={record.runtimeKind} className="size-4 shrink-0" />
              <span className="break-words">{workspaceSessionTitle(record)}</span>
            </div>
          </DialogHeader>
          <fieldset disabled={isArchiving} className="flex min-h-0 flex-1 flex-col border-0 p-0">
            <DialogBody className="flex flex-col gap-4 px-5 py-4">
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="group -ml-2 gap-1.5">
                    <ChevronDown
                      className="transition-transform group-data-[state=open]:rotate-180"
                      aria-hidden="true"
                    />
                    Working folder
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="break-all pt-2 font-mono text-xs leading-5 text-muted-foreground">
                    {record.executionTarget.workingDirectory}
                  </p>
                </CollapsibleContent>
              </Collapsible>
              <p className="text-sm text-muted-foreground">{ARCHIVE_CHAT_TEXT.stopsWork}</p>
              {children}
              {error && (
                <p role="alert" className="text-sm text-destructive-muted">
                  {errorMessage(error)}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="mt-0 justify-between border-t border-border px-5 py-4">
              <Button type="button" variant="outline" disabled={isArchiving} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={removeWorktree ? "destructive" : "default"}
                disabled={!canArchive}
                aria-busy={isArchiving}
              >
                {isArchiving ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Archive data-icon="inline-start" aria-hidden="true" />
                )}
                {isArchiving ? ARCHIVE_CHAT_TEXT.confirming : ARCHIVE_CHAT_TEXT.confirm}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveWorktreeNotice({
  removeWorktree,
  preview,
}: {
  removeWorktree: boolean;
  preview: UseQueryResult<WorkspaceSessionArchivePreview>;
}): ReactElement | null {
  const notice = worktreeArchiveNotice(removeWorktree, preview);
  if (notice.kind !== "delete_branch")
    return <p className="text-sm text-muted-foreground">{notice.text}</p>;
  // A failed check shows its own error and retry.
  if (notice.branchName === null) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Branch <span className="font-mono">{notice.branchName}</span> {notice.consequence}
    </p>
  );
}
