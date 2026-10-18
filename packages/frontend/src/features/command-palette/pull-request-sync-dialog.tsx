import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, FolderGit2, Folders, RefreshCcw, TriangleAlert } from "lucide-react";
import { type ReactElement, type ReactNode, useId } from "react";
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
import { gitProviderReadError, pullRequestHealthError } from "@/lib/git-provider-health";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useManualPullRequestSyncState } from "@/state/providers/manual-pull-request-sync-provider";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import type { PullRequestSyncTarget } from "@/types/pull-request-sync";

export function PullRequestSyncDialog({
  open,
  workspace,
  onClose,
  onCloseAutoFocus,
}: PullRequestSyncDialogProps): ReactElement {
  const { workspaces } = useWorkspaceState();
  const { pendingScope, sync } = useManualPullRequestSyncState();
  const id = useId();
  const workspaceLabelId = `${id}-workspace-label`;
  const workspacePathId = `${id}-workspace-path`;
  const workspaceHintId = `${id}-workspace-hint`;
  const allLabelId = `${id}-all-label`;
  const allCountId = `${id}-all-count`;
  const checks = useSyncChecks(open, workspaces);
  const chosen = checks.find(
    (entry) =>
      entry.workspace.workspaceId === workspace?.workspaceId &&
      entry.workspace.repoPath === workspace.repoPath,
  );
  const workspaceHint = chosen
    ? chosen.hint
    : "The chosen workspace is not open. Select an open workspace in the palette to sync it.";
  const batch = batchChoice(checks);
  const failures = checks.filter((entry) => entry.status === "error" && entry !== chosen);
  const canSyncAll = batch.targets.length > 0 && !pendingScope;
  const noWorkspaces = workspaces.length === 0;
  let workspaceNote: ReactNode = null;
  if (workspaceHint) {
    workspaceNote =
      chosen?.status === "pending" ? (
        <p id={workspaceHintId} role="status" className="text-xs text-muted-foreground">
          {workspaceHint}
        </p>
      ) : (
        <Warning id={workspaceHintId}>{workspaceHint}</Warning>
      );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg overflow-hidden p-0 outline-none"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <RefreshCcw className="size-4 text-muted-foreground" aria-hidden="true" />
            Sync pull requests
          </DialogTitle>
          <DialogDescription>Choose which workspaces to sync.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid min-h-0 grid-cols-1 gap-2 overflow-y-auto px-6 py-4">
          <Button
            variant="outline"
            className="h-auto w-full justify-start gap-3 p-3 text-left"
            aria-labelledby={workspaceLabelId}
            aria-describedby={
              workspaceHint ? `${workspacePathId} ${workspaceHintId}` : workspacePathId
            }
            disabled={workspaceHint !== null || pendingScope !== null}
            onClick={() => {
              if (!workspace || workspaceHint || pendingScope) return;
              void sync({
                kind: "workspace",
                label: `workspace ${workspace.workspaceName}`,
                targets: [workspace],
              });
              onClose();
            }}
          >
            <FolderGit2 className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span
                id={workspaceLabelId}
                className="block whitespace-normal break-words font-medium"
              >
                {workspace ? `Sync workspace ${workspace.workspaceName}` : "Sync workspace"}
              </span>
              <span
                id={workspacePathId}
                className="block truncate text-xs font-normal text-muted-foreground"
                title={workspace?.repoPath}
              >
                {workspace?.repoPath ?? "No workspace selected"}
              </span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
          {workspaceNote}
          <Button
            variant="outline"
            className="h-auto w-full justify-start gap-3 p-3 text-left"
            aria-labelledby={allLabelId}
            aria-describedby={allCountId}
            disabled={!canSyncAll}
            onClick={() => {
              if (!canSyncAll) return;
              void sync({ kind: "all", label: "all open workspaces", targets: batch.targets });
              onClose();
            }}
          >
            <Folders className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span id={allLabelId} className="block whitespace-normal font-medium">
                Sync all open workspaces
              </span>
              <span id={allCountId} className="block text-xs font-normal text-muted-foreground">
                {batch.description}
              </span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
          {failures.map((entry) => (
            <Warning key={entry.workspace.workspaceId}>
              {entry.workspace.workspaceName}: {entry.hint}
            </Warning>
          ))}
          {noWorkspaces ? (
            <p className="text-sm text-muted-foreground">Open a workspace to sync pull requests.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Skips unavailable providers.</p>
          )}
          {pendingScope ? (
            <p className="text-sm text-muted-foreground">
              Pull request sync is running for {pendingScope.label}.
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Merged pull requests can close tasks and remove task worktrees.
          </p>
        </DialogBody>
        <DialogFooter className="mt-0 justify-start border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Warning({ id, children }: { id?: string; children: ReactNode }): ReactElement {
  return (
    <div
      id={id}
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs leading-relaxed text-warning-surface-foreground"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-muted" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function useSyncChecks(open: boolean, workspaces: readonly PullRequestSyncTarget[]) {
  const queries = useQueries({
    queries: workspaces.map((workspace) => ({
      ...repositoryGitProviderContextQueryOptions(workspace.repoPath),
      enabled: open,
    })),
  });
  return workspaces.map((workspace, index) => {
    const query = queries[index]!;
    return { workspace, status: query.status, hint: providerHint(query.data, query.error) };
  });
}

function batchChoice(checks: ReturnType<typeof useSyncChecks>) {
  if (checks.some((entry) => entry.status === "error")) {
    return { targets: [], description: "Could not check all workspaces" };
  }
  if (checks.some((entry) => entry.status === "pending")) {
    return { targets: [], description: "Checking workspaces..." };
  }
  const targets = checks.filter((entry) => entry.hint === null).map((entry) => entry.workspace);
  return {
    targets,
    description: `${targets.length} eligible ${targets.length === 1 ? "workspace" : "workspaces"}`,
  };
}

function providerHint(
  context: RepositoryGitProviderContext | undefined,
  error: Error | null,
): string | null {
  const readError = gitProviderReadError(error);
  if (readError) return readError;
  if (context === undefined) return "Checking Git provider...";
  if (context === null) {
    return "No Git provider is configured. Set one up in Git provider settings.";
  }
  if (!context.config.enabled) {
    return "The Git provider is disabled. Enable it in Git provider settings.";
  }
  if (!context.descriptor.capabilities.supportsPullRequests) {
    return "The configured Git provider does not support pull requests.";
  }
  return pullRequestHealthError(context);
}

type PullRequestSyncDialogProps = {
  open: boolean;
  workspace: PullRequestSyncTarget | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
};
