import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import { useStartupAttempt } from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import type { ReactElement } from "react";
import { StartupTrace } from "@/features/session-startup/startup-trace";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import type { BranchesFailure } from "../use-workspace-repo-settings";
import { SessionStartForm } from "./session-start-form";

/** The same guarded start step serves quick actions, approvals, and review feedback. */
export function SessionStartSheet({
  model,
  branchesFailure,
  onClose,
  onEdit,
}: {
  model: SessionStartModalModel;
  branchesFailure: BranchesFailure | null;
  onClose?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
}): ReactElement {
  const attemptId = model.phase.kind === "progress" ? model.phase.startupAttemptId : null;
  const attempt = useStartupAttempt(attemptId);
  return (
    <GroupedSheet
      title={model.title}
      onClose={onClose ?? (() => model.onOpenChange(false))}
      closable={!model.isStarting && !startupIsPending(attempt)}
    >
      {attemptId ? (
        <StartupTrace
          attemptId={attemptId}
          onEditChoices={model.onEditChoices}
          onContinueInBackground={model.onContinueInBackground}
        />
      ) : (
        <SessionStartForm model={model} branchesFailure={branchesFailure} onEdit={onEdit} />
      )}
    </GroupedSheet>
  );
}
