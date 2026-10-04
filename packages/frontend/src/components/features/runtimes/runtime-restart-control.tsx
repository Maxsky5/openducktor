import type {
  RuntimeKind,
  RuntimeLifecycleImpact,
  RuntimeRestartResult,
} from "@openducktor/contracts";
import { RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import { hostClient } from "@/lib/host-client";
import { RuntimeImpactDialog } from "./runtime-impact-dialog";
import { type RuntimeImpactAction, useRuntimeImpactReview } from "./runtime-impact-review";

export type RuntimeRestartPorts = {
  runtimeRestartImpact: (runtimeKind: RuntimeKind) => Promise<RuntimeLifecycleImpact>;
  runtimeRestart: (runtimeKind: RuntimeKind, confirmation: string) => Promise<RuntimeRestartResult>;
};

const productionPorts: RuntimeRestartPorts = {
  runtimeRestartImpact: (runtimeKind) => hostClient.runtimeRestartImpact(runtimeKind),
  runtimeRestart: (runtimeKind, confirmation) =>
    hostClient.runtimeRestart(runtimeKind, confirmation),
};

type RuntimeRestartControlProps = {
  runtimeKind: RuntimeKind;
  runtimeLabel: string;
  /** `Retry apply` retries a saved runtime setting through the same restart command. */
  actionLabel: "Restart" | "Retry apply";
  /** True while the host runs a lifecycle action for this kind. */
  isLifecycleBusy: boolean;
  ports?: RuntimeRestartPorts;
};

/**
 * Reviews live-session impact, then restarts one runtime kind. The review stays current through
 * host events while it is open. Progress comes from status events.
 */
export function RuntimeRestartControl({
  runtimeKind,
  runtimeLabel,
  actionLabel,
  isLifecycleBusy,
  ports = productionPorts,
}: RuntimeRestartControlProps): ReactElement {
  const { review, open, confirm, cancel } = useRuntimeImpactReview({ kinds: [runtimeKind] });
  const isOpen = review !== null;
  const isDialogMounted = useDialogPresence(isOpen);

  const restart: RuntimeImpactAction = async (impact) => {
    try {
      const result = await ports.runtimeRestart(runtimeKind, impact.confirmation);
      // The diagnostics entry shows the new state, or the failed stage and reason.
      return result.type === "impact_changed" ? result : { type: "completed" };
    } catch (cause) {
      return { type: "failed", error: errorMessage(cause) };
    }
  };

  const openReview = (): void => {
    void open({ readImpact: () => ports.runtimeRestartImpact(runtimeKind), run: restart });
  };

  const isActionDisabled = isLifecycleBusy || (review?.isPending ?? false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isActionDisabled}
        onClick={openReview}
        aria-label={`${actionLabel} ${runtimeLabel} runtime`}
      >
        <RotateCcw className="size-3.5" />
        {actionLabel}
      </Button>
      {isDialogMounted ? (
        <RuntimeImpactDialog
          open={isOpen}
          title={`${actionLabel} ${runtimeLabel} runtime`}
          description="The host stops the current runtime and starts it again with the saved executable."
          confirmLabel={actionLabel}
          impact={review?.impact ?? null}
          isLoadingImpact={review?.isLoadingImpact ?? false}
          impactError={review?.impactError ?? null}
          notice={review?.notice ?? null}
          isPending={review?.isPending ?? false}
          error={review?.error ?? null}
          onConfirm={confirm}
          onCancel={cancel}
        />
      ) : null}
    </>
  );
}
