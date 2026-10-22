import type { WorkspaceSession } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
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
import {
  invalidateRepoBranchesQuery,
  repoBranchesQueryOptions,
} from "@openducktor/frontend-core/queries/git";
import { invalidateTerminalList } from "@openducktor/frontend-core/queries/terminals";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import {
  updateWorkspaceSessionQueries,
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "@openducktor/frontend-core/queries/workspace-sessions";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
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
  const host = useHostClient();
  const queryClient = useQueryClient();
  const archived = useQuery(workspaceSessionListQueryOptions(workspaceId, true));
  const repoConfig = useQuery(repoConfigQueryOptions(workspaceId));
  const defaultTarget = repoConfig.data?.defaultTargetBranch ?? null;
  const branches = useQuery({
    ...repoBranchesQueryOptions(repoPath),
    enabled: archived.data?.some(hasRemovedWorktree) ?? false,
  });
  const [filter, setFilter] = useState("");
  const search = filter.trim().toLowerCase();
  const filteredSessions = archived.data?.filter((record) =>
    [
      workspaceSessionTitle(record),
      record.roleSnapshot?.name ?? "No role",
      record.executionTarget.workingDirectory,
    ].some((value) => value.toLowerCase().includes(search)),
  );
  const restore = useMutation({
    mutationFn: (sessionId: string) => host.workspaceSessionRestore({ workspaceId, sessionId }),
    onSuccess: async (session) => {
      updateWorkspaceSessionQueries(queryClient, workspaceId, session);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceSessionQueryKeys.list(workspaceId, true),
          exact: true,
        }),
        invalidateTerminalList(queryClient, {
          kind: "workspace_session",
          workspaceId,
          sessionId: session.id,
        }),
      ]);
    },
    onSettled: () => {
      void invalidateRepoBranchesQuery(queryClient, repoPath);
    },
  });
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
          <DialogTitle>Archived chats</DialogTitle>
          <DialogDescription>Restore a chat to return it to your workspace.</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label="Filter archived chats"
          placeholder="Filter by title, role, or path…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="mt-4 shrink-0"
        />
        <DialogBody className="mt-4 flex max-h-96 flex-col gap-2 overflow-y-auto p-1">
          {(archived.isPending || archived.isFetching) && (
            <p role="status">Loading archived sessions…</p>
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
          {filteredSessions?.map((record) => (
            <div
              key={record.id}
              className="flex items-center gap-4 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{workspaceSessionTitle(record)}</p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={record.executionTarget.workingDirectory}
                >
                  {record.roleSnapshot?.name ?? "No role"} ·{" "}
                  {record.executionTarget.workingDirectory}
                </p>
                {hasRemovedWorktree(record) && (
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
                disabled={restore.isPending || archived.isFetching}
                aria-label={`Restore ${workspaceSessionTitle(record)}`}
                onClick={() => restore.mutate(record.id)}
              >
                {restore.isPending && restore.variables === record.id ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                Restore
              </Button>
            </div>
          ))}
          {isArchiveSettled && archived.data?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No archived sessions.</p>
          )}
          {isArchiveSettled && archived.data.length > 0 && filteredSessions?.length === 0 && (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">
              No chats match your filter.
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function hasRemovedWorktree(record: WorkspaceSession): boolean {
  return (
    record.executionTarget.kind === "local_worktree" &&
    record.executionTarget.worktreeState === "removed"
  );
}
