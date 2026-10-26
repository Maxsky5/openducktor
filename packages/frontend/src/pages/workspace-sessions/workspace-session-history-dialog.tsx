import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { repoBranchesQueryOptions } from "@openducktor/frontend-core/queries/git";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import {
  ARCHIVED_CHATS_TEXT,
  filterWorkspaceSessions,
  isArchivedWorktreeRemoved,
  useRestoreWorkspaceSession,
  workspaceSessionRoleName,
} from "@openducktor/frontend-core/workspace-sessions/archived-workspace-sessions";
import { WorkspaceSessionRemovedWorktreeTarget } from "./workspace-session-removed-worktree-target";

export function WorkspaceSessionHistoryDialog({
  workspaceId,
  repoPath,
  onClose,
  onCloseAutoFocus,
}: {
  workspaceId: string;
  repoPath: string;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const archived = useQuery(workspaceSessionListQueryOptions(workspaceId, true));
  const repoConfig = useQuery(repoConfigQueryOptions(workspaceId));
  const defaultTarget = repoConfig.data?.defaultTargetBranch ?? null;
  const branches = useQuery({
    ...repoBranchesQueryOptions(repoPath),
    enabled: archived.data?.some(isArchivedWorktreeRemoved) ?? false,
  });
  const [filter, setFilter] = useState("");
  const filteredSessions = archived.data
    ? filterWorkspaceSessions(archived.data, filter)
    : undefined;
  const restore = useRestoreWorkspaceSession({ workspaceId, repoPath });
  const isArchiveSettled = archived.isSuccess && !archived.isFetching && !restore.isPending;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{ARCHIVED_CHATS_TEXT.title}</DialogTitle>
          <DialogDescription>{ARCHIVED_CHATS_TEXT.description}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label={ARCHIVED_CHATS_TEXT.filterLabel}
          placeholder={ARCHIVED_CHATS_TEXT.filterPlaceholder}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="mt-4 shrink-0"
        />
        <DialogBody className="mt-4 flex max-h-96 flex-col gap-2 overflow-y-auto p-1">
          <ArchivedListProblems archived={archived} branches={branches} restore={restore} />
          {filteredSessions?.map((record) => (
            <ArchivedSessionRow
              key={record.id}
              workspaceId={workspaceId}
              record={record}
              defaultTarget={defaultTarget}
              branches={branches}
              restore={restore}
              listFetching={archived.isFetching}
            />
          ))}
          {isArchiveSettled ? (
            <ArchivedListEnd total={archived.data.length} shown={filteredSessions?.length ?? 0} />
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

type ArchivedSession = NonNullable<ReturnType<typeof filterWorkspaceSessions>>[number];
type RemovedWorktreeTargetProps = ComponentProps<typeof WorkspaceSessionRemovedWorktreeTarget>;

/** One archived chat with its Restore button, and its target branch when its worktree is gone. */
function ArchivedSessionRow({
  workspaceId,
  record,
  defaultTarget,
  branches,
  restore,
  listFetching,
}: {
  workspaceId: string;
  record: ArchivedSession;
  defaultTarget: RemovedWorktreeTargetProps["defaultTarget"];
  branches: RemovedWorktreeTargetProps["branches"];
  restore: ReturnType<typeof useRestoreWorkspaceSession>;
  listFetching: boolean;
}) {
  const title = workspaceSessionTitle(record);
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={record.executionTarget.workingDirectory}
        >
          {workspaceSessionRoleName(record)} · {record.executionTarget.workingDirectory}
        </p>
        {isArchivedWorktreeRemoved(record) && (
          <WorkspaceSessionRemovedWorktreeTarget
            workspaceId={workspaceId}
            record={record}
            defaultTarget={defaultTarget}
            branches={branches}
            disabled={restore.isPending}
            // A new target answers the last restore failure.
            onSaved={restore.reset}
          />
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={restore.isPending || listFetching}
        aria-label={`Restore ${title}`}
        onClick={() => restore.mutate(record.id)}
      >
        {restore.isPending && restore.variables === record.id ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <RotateCcw />
        )}
        {ARCHIVED_CHATS_TEXT.restore}
      </Button>
    </div>
  );
}

/** The loading line and the failures above the archived chats, each with its retry. */
function ArchivedListProblems({
  archived,
  branches,
  restore,
}: {
  archived: UseQueryResult<unknown>;
  branches: UseQueryResult<unknown>;
  restore: Pick<ReturnType<typeof useRestoreWorkspaceSession>, "error">;
}) {
  return (
    <>
      {(archived.isPending || archived.isFetching) && (
        <p role="status">{ARCHIVED_CHATS_TEXT.loading}</p>
      )}
      {archived.isError && (
        <div role="alert">
          <p className="text-sm text-destructive">{errorMessage(archived.error)}</p>
          <Button
            variant="outline"
            disabled={archived.isFetching}
            onClick={() => void archived.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {branches.isError && (
        <div role="alert">
          <p className="text-sm text-destructive">{errorMessage(branches.error)}</p>
          <Button variant="ghost" onClick={() => void branches.refetch()}>
            Retry branches
          </Button>
        </div>
      )}
      {restore.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(restore.error)}
        </p>
      )}
    </>
  );
}

/** The empty state of a settled list: no archived chat, or none that matches the filter. */
function ArchivedListEnd({ total, shown }: { total: number; shown: number }) {
  if (total === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">{ARCHIVED_CHATS_TEXT.empty}</p>
    );
  }
  if (shown > 0) return null;
  return (
    <p role="status" className="py-6 text-center text-sm text-muted-foreground">
      {ARCHIVED_CHATS_TEXT.noMatch}
    </p>
  );
}
