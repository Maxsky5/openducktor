import type { AutopilotOutcome } from "@openducktor/contracts";
import { toast } from "sonner";
import {
  AUTOPILOT_FAILURE_TITLE,
  AUTOPILOT_NOT_CLAIMED_DESCRIPTION,
  AUTOPILOT_RETRY_MESSAGE_LABEL,
  autopilotFailedDescription,
  autopilotFailedTitle,
  autopilotNotClaimedTitle,
  autopilotRecoveryTitle,
  autopilotSkippedTitle,
} from "@openducktor/frontend-core/autopilot/autopilot-outcome-copy";
import {
  type AutopilotFailedOutcome,
  type AutopilotRecovery,
  type AutopilotRecoveryPorts,
  createAutopilotRecovery,
  retryAutopilotRecovery,
} from "@openducktor/frontend-core/autopilot/autopilot-recovery";
import { RESULT_UNKNOWN_TITLE } from "@openducktor/frontend-core/lib/command-outcome";

export type AutopilotOutcomePresenterPorts = AutopilotRecoveryPorts & {
  /** Another view shows this host session error, so its notification skips the in-app toast. */
  markInAppFeedbackHandled: (errorId: string) => void;
  refreshTaskViews: (repoPath: string, taskId: string) => Promise<void>;
};

const FAILURE_TOAST_ID = "autopilot-failure";
const RECOVERY_TOAST_CLASS_NAMES = {
  toast: "!flex-col !items-stretch",
  content: "w-full",
  actionButton: "!m-0 !h-9 !w-full !rounded-md justify-center",
};

const toastId = (outcome: AutopilotOutcome): string => `autopilot:${outcome.outcomeId}`;

/**
 * Shows Autopilot outcomes from the host. Each outcome appears once in a page session, and a
 * dismissal affects only this client. A failed launch that this client can still recover appears
 * again when the user selects its workspace again.
 */
export const createAutopilotOutcomePresenter = (ports: AutopilotOutcomePresenterPorts) => {
  const shown = new Set<string>();
  const recoveries = new Map<string, AutopilotRecovery>();
  const toastIdsByWorkspace = new Map<string, Set<string>>();

  const track = (outcome: AutopilotOutcome): string => {
    const id = toastId(outcome);
    const ids = toastIdsByWorkspace.get(outcome.workspaceId) ?? new Set<string>();
    ids.add(id);
    toastIdsByWorkspace.set(outcome.workspaceId, ids);
    return id;
  };

  const showRecovery = (recovery: AutopilotRecovery): void => {
    const { outcome } = recovery;
    toast.error(autopilotRecoveryTitle(outcome), {
      id: toastId(outcome),
      description: recovery.message,
      duration: Infinity,
      classNames: RECOVERY_TOAST_CLASS_NAMES,
      action: {
        label: AUTOPILOT_RETRY_MESSAGE_LABEL,
        onClick: () => {
          void retry(recovery);
        },
      },
    });
  };

  // A retry does nothing while a claim or send runs, or after the recovery ended.
  const retry = async (recovery: AutopilotRecovery): Promise<void> => {
    const result = await retryAutopilotRecovery(recovery, ports);
    if (result === "workspace_not_selected" || result === "failed") {
      showRecovery(recovery);
      return;
    }
    if (result === "unknown") {
      toast.warning(RESULT_UNKNOWN_TITLE, {
        id: toastId(recovery.outcome),
        description: recovery.message,
        duration: Infinity,
      });
      return;
    }
    if (result === "not_claimed") {
      const { outcome } = recovery;
      toast.info(autopilotNotClaimedTitle(outcome), {
        id: toastId(outcome),
        description: AUTOPILOT_NOT_CLAIMED_DESCRIPTION,
      });
    }
  };

  const presentFailed = (outcome: AutopilotFailedOutcome): void => {
    const id = track(outcome);
    const { launch } = outcome;
    // This toast shows the failure, so the host error notification skips its in-app toast.
    const errorId = launch?.failure?.noticeId ?? outcome.notificationId;
    if (errorId) ports.markInAppFeedbackHandled(errorId);
    const recovery = createAutopilotRecovery(outcome);
    if (recovery) {
      recoveries.set(outcome.outcomeId, recovery);
      showRecovery(recovery);
      return;
    }
    toast.error(autopilotFailedTitle(outcome), {
      id,
      description: autopilotFailedDescription(outcome),
      duration: Infinity,
    });
  };

  return {
    /** `workspaceSelected` marks outcomes that a client reads after it selects their workspace. */
    present(outcome: AutopilotOutcome, { workspaceSelected = false } = {}): void {
      if (shown.has(outcome.outcomeId)) {
        const recovery = recoveries.get(outcome.outcomeId);
        if (workspaceSelected && recovery && !recovery.pending && !recovery.done)
          showRecovery(recovery);
        return;
      }
      shown.add(outcome.outcomeId);
      // A failed launch can still create a worktree or a terminal.
      if (outcome.kind !== "skipped")
        void ports
          .refreshTaskViews(outcome.repoPath, outcome.task.id)
          .catch((cause) => console.error("Cannot refresh the Autopilot task views.", cause));
      // The host notification shows a started session.
      if (outcome.kind === "started") return;
      if (outcome.kind === "skipped") {
        toast.info(autopilotSkippedTitle(outcome), {
          id: track(outcome),
          description: outcome.reason,
        });
        return;
      }
      presentFailed(outcome);
    },
    presentFailure(failure: string | null): void {
      if (failure === null) {
        toast.dismiss(FAILURE_TOAST_ID);
        return;
      }
      toast.error(AUTOPILOT_FAILURE_TITLE, {
        id: FAILURE_TOAST_ID,
        description: failure,
        duration: Infinity,
      });
    },
    /** Dismisses the outcomes of workspaces that the host no longer lists. */
    keepWorkspaces(workspaceIds: ReadonlySet<string>): void {
      for (const [workspaceId, ids] of toastIdsByWorkspace) {
        if (workspaceIds.has(workspaceId)) continue;
        for (const id of ids) toast.dismiss(id);
        toastIdsByWorkspace.delete(workspaceId);
      }
      for (const [outcomeId, recovery] of recoveries)
        if (!workspaceIds.has(recovery.outcome.workspaceId)) recoveries.delete(outcomeId);
    },
  };
};

export type AutopilotOutcomePresenter = ReturnType<typeof createAutopilotOutcomePresenter>;
