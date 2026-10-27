import { FolderGit2, Folders, GitMerge } from "lucide-react";
import { type ReactElement, useId } from "react";
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
import { useWorkspaceState } from "@/state/app-state-provider";
import { useManualMergeCheckState } from "@/state/providers/manual-merge-check-provider";
import type { WorkspaceScopeTarget } from "@/types/workspace-scope";
import { ScopeChoiceButton, ScopeWarning } from "./workspace-scope-choice";

/** Chooses the workspaces of a manual merge check: the named workspace, or all open workspaces. */
export function MergeCheckDialog({
  open,
  workspace,
  onClose,
  onCloseAutoFocus,
}: {
  open: boolean;
  workspace: WorkspaceScopeTarget | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  const { workspaces } = useWorkspaceState();
  const { pendingScope, check } = useManualMergeCheckState();
  const id = useId();
  const workspaceLabelId = `${id}-workspace-label`;
  const workspacePathId = `${id}-workspace-path`;
  const workspaceHintId = `${id}-workspace-hint`;
  const allLabelId = `${id}-all-label`;
  const allCountId = `${id}-all-count`;
  const chosen = workspaces.find(
    (entry) =>
      entry.workspaceId === workspace?.workspaceId && entry.repoPath === workspace.repoPath,
  );
  const workspaceHint = chosen
    ? null
    : "The chosen workspace is not open. Select an open workspace in the palette to check it.";
  const canCheckAll = workspaces.length > 0 && !pendingScope;
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
            <GitMerge className="size-4 text-muted-foreground" aria-hidden="true" />
            Check merged tasks
          </DialogTitle>
          <DialogDescription>Choose which workspaces to check.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid min-h-0 grid-cols-1 gap-2 overflow-y-auto px-6 py-4">
          <ScopeChoiceButton
            icon={FolderGit2}
            label={workspace ? `Check workspace ${workspace.workspaceName}` : "Check workspace"}
            detail={workspace?.repoPath ?? "No workspace selected"}
            detailTitle={workspace?.repoPath}
            labelId={workspaceLabelId}
            detailId={workspacePathId}
            describedBy={workspaceHint ? `${workspacePathId} ${workspaceHintId}` : workspacePathId}
            disabled={!chosen || pendingScope !== null}
            onChoose={() => {
              if (!chosen || pendingScope) return;
              void check({
                kind: "workspace",
                label: `workspace ${chosen.workspaceName}`,
                targets: [chosen],
              });
              onClose();
            }}
          />
          {workspaceHint ? <ScopeWarning id={workspaceHintId}>{workspaceHint}</ScopeWarning> : null}
          <ScopeChoiceButton
            icon={Folders}
            label="Check all open workspaces"
            detail={`${workspaces.length} open ${workspaces.length === 1 ? "workspace" : "workspaces"}`}
            labelId={allLabelId}
            detailId={allCountId}
            describedBy={allCountId}
            disabled={!canCheckAll}
            onChoose={() => {
              if (!canCheckAll) return;
              void check({ kind: "all", label: "all open workspaces", targets: workspaces });
              onClose();
            }}
          />
          {workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">Open a workspace to check merged tasks.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Fetches the target branches of each workspace, then checks each task branch.
            </p>
          )}
          {pendingScope ? (
            <p className="text-sm text-muted-foreground">
              Merge check is running for {pendingScope.label}.
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            A merged task branch only proposes Close Task. No task closes on its own.
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
