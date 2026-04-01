import { ArrowUp } from "lucide-react";
import { memo, type ReactElement } from "react";
import type { AgentStudioPendingForcePush } from "@/features/agent-studio-git";
import { INLINE_CODE_CLASS_NAME } from "./constants";
import { GitConfirmationDialog } from "./git-confirmation-dialog";

type ForcePushDialogProps = {
  pendingForcePush: AgentStudioPendingForcePush | null;
  isPushing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export const ForcePushDialog = memo(function ForcePushDialog({
  pendingForcePush,
  isPushing,
  onCancel,
  onConfirm,
}: ForcePushDialogProps): ReactElement {
  return (
    <GitConfirmationDialog
      open={pendingForcePush != null}
      onOpenChange={(open) => {
        if (isPushing) {
          return;
        }
        if (!open) {
          onCancel();
        }
      }}
      title="Confirm force push"
      description={
        <>
          The remote rejected a normal push because the upstream branch moved. Continue only if you
          intend to rewrite the remote branch history.
        </>
      }
      closeDisabled={isPushing}
      onClose={onCancel}
      closeTestId="agent-studio-git-cancel-force-push-button"
      confirmLabel="Force push with lease"
      confirmPendingLabel="Force pushing..."
      confirmPending={isPushing}
      confirmDisabled={isPushing}
      onConfirm={onConfirm}
      confirmTestId="agent-studio-git-confirm-force-push-button"
      confirmIcon={ArrowUp}
      contentTestId="agent-studio-git-force-push-modal"
    >
      <div className="space-y-4" data-testid="agent-studio-git-force-push-body">
        <div className="rounded-xl border border-border bg-muted/35 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Branch
          </p>
          <div className="mt-2">
            <code className={INLINE_CODE_CLASS_NAME}>{pendingForcePush?.branch ?? ""}</code>
          </div>
        </div>

        <div
          className="rounded-xl border border-info-border bg-info-surface px-4 py-4 text-info-surface-foreground"
          data-testid="agent-studio-git-force-push-safety-note"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-info-surface-foreground">
            Retry mode
          </p>
          <p className="mt-2 text-sm leading-6 text-info-surface-foreground">
            The retry uses <code className={INLINE_CODE_CLASS_NAME}>--force-with-lease</code>. Git
            checks that the remote branch still points to the commit you last fetched. If someone
            pushed in the meantime, the retry fails instead of overwriting their work. This panel
            never uses <code className={INLINE_CODE_CLASS_NAME}>--force</code>.
          </p>
        </div>

        {pendingForcePush ? (
          <div className="rounded-xl border border-border bg-muted/40 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Git output
            </p>
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-border bg-background/80 p-3 text-xs whitespace-pre-wrap text-foreground">
              {pendingForcePush.output}
            </pre>
          </div>
        ) : null}
      </div>
    </GitConfirmationDialog>
  );
});
