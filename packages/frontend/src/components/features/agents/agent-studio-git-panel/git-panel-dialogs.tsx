import { Undo2 } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { AgentStudioPendingDiscard } from "@openducktor/frontend-core/git/contracts";
import { GitConflictDialog } from "@/features/git-conflict-resolution";
import { INLINE_CODE_CLASS_NAME } from "./constants";
import { ForcePushDialog } from "./force-push-dialog";
import { GitConfirmationDialog } from "./git-confirmation-dialog";
import { PullRebaseDialog } from "./pull-rebase-dialog";
import type { AgentStudioGitPanelModel } from "./types";
import type { GitPanelConflict } from "./use-git-conflict-panel";

export function AgentStudioGitPanelDialogs({
  model,
  conflict,
}: {
  model: AgentStudioGitPanelModel;
  conflict: GitPanelConflict;
}): ReactElement {
  const pendingDiscard = model.pendingDiscard ?? null;
  const confirmDisabled = [
    model.isCommitting,
    model.isPushing,
    model.isRebasing,
    model.isChanging,
    model.isHandlingGitConflict,
    model.isGitActionsLocked,
  ].some(Boolean);
  const discardDialog = getDiscardDialog(pendingDiscard);
  return (
    <>
      {conflict.modalActions ? (
        <GitConflictDialog
          conflict={conflict.active}
          open={conflict.hasConflict && conflict.isModalOpen}
          onOpenChange={conflict.setModalOpen}
          actions={conflict.modalActions}
        />
      ) : null}
      <ForcePushDialog
        pendingForcePush={model.pendingForcePush ?? null}
        confirmDisabled={confirmDisabled}
        isPushing={model.isPushing ?? false}
        onCancel={() => model.cancelForcePush?.()}
        onConfirm={() => void model.confirmForcePush?.()}
      />
      <PullRebaseDialog
        pendingPullRebase={model.pendingPullRebase ?? null}
        confirmDisabled={confirmDisabled}
        isRebasing={model.isRebasing ?? false}
        onCancel={() => model.cancelPullRebase?.()}
        onConfirm={() => void model.confirmPullRebase?.()}
      />
      <GitConfirmationDialog
        open={pendingDiscard != null}
        onOpenChange={(open) => {
          if (!open) model.cancelDiscard?.();
        }}
        title={discardDialog.title}
        description={discardDialog.description}
        closeLabel="Keep changes"
        closeDisabled={false}
        onClose={() => model.cancelDiscard?.()}
        closeTestId="agent-studio-git-cancel-discard-button"
        confirmLabel={discardDialog.confirmLabel}
        confirmPendingLabel="Discarding..."
        confirmPending={false}
        confirmDisabled={confirmDisabled}
        onConfirm={() => void model.confirmDiscard?.()}
        confirmTestId="agent-studio-git-confirm-discard-button"
        confirmIcon={Undo2}
        contentTestId="agent-studio-git-discard-modal"
      >
        {discardDialog.body}
      </GitConfirmationDialog>
    </>
  );
}

function getDiscardDialog(pending: AgentStudioPendingDiscard | null) {
  const filePath = pending?.selection.filePath ?? "";
  const isChunk = pending?.selection.kind === "hunk";
  const groupLabel = pending?.group === "staged" ? "staged" : "unstaged";
  const path = <code className={INLINE_CODE_CLASS_NAME}>{filePath}</code>;
  let description: ReactNode;
  if (pending?.isUntrackedFile) {
    description = <>This deletes the untracked file {path}. You cannot undo this.</>;
  } else if (pending?.group === "staged") {
    description = (
      <>
        This removes the selected staged {isChunk ? "chunk" : "changes"} of {path} from the next
        commit and from the working file. Unrelated unstaged edits stay. You cannot undo this.
      </>
    );
  } else {
    description = (
      <>
        This removes the selected unstaged {isChunk ? "chunk" : "changes"} of {path} from the
        working file. Staged content stays. You cannot undo this.
      </>
    );
  }
  const scope =
    pending?.selection.kind === "hunk" ? `Chunk ${pending.selection.hunkIndex + 1}` : "Whole file";
  const body = pending ? (
    <div
      className="rounded-xl border border-border bg-muted/50 p-4"
      data-testid="agent-studio-git-discard-summary"
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <dt>File</dt>
        <dd className="min-w-0 break-all">{path}</dd>
        <dt>Group</dt>
        <dd className="text-foreground">{pending.group === "staged" ? "Staged" : "Unstaged"}</dd>
        <dt>Scope</dt>
        <dd className="text-foreground">{scope}</dd>
      </dl>
    </div>
  ) : null;
  let confirmLabel = isChunk ? "Discard chunk" : "Discard changes";
  if (pending?.isUntrackedFile) confirmLabel = "Delete file";
  return {
    title: pending?.isUntrackedFile ? "Delete untracked file?" : `Discard ${groupLabel} changes?`,
    description,
    confirmLabel,
    body,
  };
}
