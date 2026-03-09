import { ArrowDown } from "lucide-react";
import { memo, type ReactElement } from "react";
import type { AgentStudioPendingPullRebase } from "@/pages/agents/use-agent-studio-git-actions";
import { INLINE_CODE_CLASS_NAME } from "./constants";
import { GitConfirmationDialog } from "./git-confirmation-dialog";

type PullRebaseDialogProps = {
  pendingPullRebase: AgentStudioPendingPullRebase | null;
  isRebasing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export const PullRebaseDialog = memo(function PullRebaseDialog({
  pendingPullRebase,
  isRebasing,
  onCancel,
  onConfirm,
}: PullRebaseDialogProps): ReactElement {
  const localAhead = pendingPullRebase?.localAhead ?? 0;
  const upstreamBehind = pendingPullRebase?.upstreamBehind ?? 0;

  return (
    <GitConfirmationDialog
      open={pendingPullRebase != null}
      onOpenChange={(open) => {
        if (isRebasing) {
          return;
        }
        if (!open) {
          onCancel();
        }
      }}
      title="Confirm pull with rebase"
      description={
        <>
          Pulling <code className={INLINE_CODE_CLASS_NAME}>{pendingPullRebase?.branch ?? ""}</code>{" "}
          will run <code className={INLINE_CODE_CLASS_NAME}>git pull --rebase</code> before
          integrating upstream changes.
        </>
      }
      closeDisabled={isRebasing}
      onClose={onCancel}
      closeTestId="agent-studio-git-cancel-pull-rebase-button"
      confirmLabel="Pull with rebase"
      confirmPendingLabel="Pulling..."
      confirmPending={isRebasing}
      confirmDisabled={isRebasing}
      onConfirm={onConfirm}
      confirmTestId="agent-studio-git-confirm-pull-rebase-button"
      confirmIcon={ArrowDown}
      contentTestId="agent-studio-git-pull-rebase-modal"
    >
      <div
        className="rounded-xl border border-border bg-muted/50 px-4 py-4"
        data-testid="agent-studio-git-pull-rebase-safety-note"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Rebase effect
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This will replay {localAhead} local commit{localAhead === 1 ? "" : "s"} on top of{" "}
          {upstreamBehind} upstream commit{upstreamBehind === 1 ? "" : "s"}.
        </p>
      </div>
    </GitConfirmationDialog>
  );
});
