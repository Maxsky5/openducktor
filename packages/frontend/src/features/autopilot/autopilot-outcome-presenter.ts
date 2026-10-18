import type {
  AgentSessionUserMessagePart,
  AutopilotOutcome,
  AutopilotRecoveryClaimInput,
  AutopilotRecoveryClaimResult,
} from "@openducktor/contracts";
import { AUTOPILOT_ACTION_DEFINITIONS } from "@openducktor/core";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { toAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

export type AutopilotOutcomePresenterPorts = {
  claimRecovery: (input: AutopilotRecoveryClaimInput) => Promise<AutopilotRecoveryClaimResult>;
  /** Sends the unsent first instruction through the normal session send path. */
  sendMessage: (
    session: AgentSessionIdentity,
    instruction: AgentSessionUserMessagePart[],
  ) => Promise<void>;
  /** Another view shows this host session error, so its notification skips the in-app toast. */
  markInAppFeedbackHandled: (errorId: string) => void;
  /** The session send path works only in the selected workspace. */
  isWorkspaceSelected: (workspaceId: string) => boolean;
  refreshTaskViews: (repoPath: string, taskId: string) => Promise<void>;
};

type FailedOutcome = Extract<AutopilotOutcome, { kind: "failed" }>;

const FAILURE_TOAST_ID = "autopilot-failure";
const RECOVERY_TOAST_CLASS_NAMES = {
  toast: "!flex-col !items-stretch",
  content: "w-full",
  actionButton: "!m-0 !h-9 !w-full !rounded-md justify-center",
};

const toastId = (outcome: AutopilotOutcome): string => `autopilot:${outcome.outcomeId}`;
const actionLabel = (outcome: AutopilotOutcome): string =>
  AUTOPILOT_ACTION_DEFINITIONS[outcome.actionId].label;

/** The first-message recovery of one failed launch. It outlives each replacement toast. */
type Recovery = {
  outcome: FailedOutcome;
  session: AgentSessionIdentity;
  instruction: AgentSessionUserMessagePart[];
  message: string;
  /** This client holds the host claim, so it can send again without a new claim. */
  claimed: boolean;
  /** A claim or send runs now. */
  pending: boolean;
  /** The instruction reached the session, or another client owns the recovery. */
  done: boolean;
};

/**
 * Shows Autopilot outcomes from the host. Each outcome appears once in a page session, and a
 * dismissal affects only this client. A failed launch that this client can still recover appears
 * again when the user selects its workspace again.
 */
export const createAutopilotOutcomePresenter = (ports: AutopilotOutcomePresenterPorts) => {
  const shown = new Set<string>();
  const recoveries = new Map<string, Recovery>();
  const toastIdsByWorkspace = new Map<string, Set<string>>();

  const track = (outcome: AutopilotOutcome): string => {
    const id = toastId(outcome);
    const ids = toastIdsByWorkspace.get(outcome.workspaceId) ?? new Set<string>();
    ids.add(id);
    toastIdsByWorkspace.set(outcome.workspaceId, ids);
    return id;
  };

  const showRecovery = (recovery: Recovery): void => {
    const { outcome } = recovery;
    toast.error(
      `Autopilot started ${actionLabel(outcome)} for ${outcome.task.id}, but the first message failed.`,
      {
        id: toastId(outcome),
        description: recovery.message,
        duration: Infinity,
        classNames: RECOVERY_TOAST_CLASS_NAMES,
        action: {
          label: "Retry message",
          onClick: () => {
            void retry(recovery);
          },
        },
      },
    );
  };

  // A retry does nothing while a claim or send runs, or after the recovery ended.
  const retry = async (recovery: Recovery): Promise<void> => {
    if (recovery.pending || recovery.done) return;
    const { outcome } = recovery;
    if (!recovery.claimed && !ports.isWorkspaceSelected(outcome.workspaceId)) {
      recovery.message = `Select the workspace of ${outcome.task.id}, then retry the message.`;
      showRecovery(recovery);
      return;
    }
    recovery.pending = true;
    try {
      // Only one client can send the instruction again.
      if (!recovery.claimed) {
        const claim = await ports.claimRecovery({
          workspaceId: outcome.workspaceId,
          outcomeId: outcome.outcomeId,
        });
        if (!claim.claimed) {
          recovery.done = true;
          toast.info(`Autopilot did not send the message for ${outcome.task.id} again.`, {
            id: toastId(outcome),
            description:
              "A retry already ran for this message, or a later Autopilot action replaced it. Open the session to check it, then send a new message if needed.",
          });
          return;
        }
        recovery.claimed = true;
      }
      await ports.sendMessage(recovery.session, recovery.instruction);
      recovery.done = true;
    } catch (cause) {
      recovery.message = errorMessage(cause);
      showRecovery(recovery);
    } finally {
      recovery.pending = false;
    }
  };

  const presentFailed = (outcome: FailedOutcome): void => {
    const id = track(outcome);
    const { launch } = outcome;
    // This toast shows the failure, so the host error notification skips its in-app toast.
    const errorId = launch?.failure?.noticeId ?? outcome.notificationId;
    if (errorId) ports.markInAppFeedbackHandled(errorId);
    if (launch?.session && launch.unsentInstruction) {
      const recovery: Recovery = {
        outcome,
        session: toAgentSessionIdentity(launch.session),
        instruction: launch.unsentInstruction,
        message: outcome.message,
        claimed: false,
        pending: false,
        done: false,
      };
      recoveries.set(outcome.outcomeId, recovery);
      showRecovery(recovery);
      return;
    }
    const nextStep = launch?.session
      ? "Open the session to check it, then start the action again if needed."
      : "Fix the cause, then start the action from the task.";
    toast.error(`Autopilot could not start ${actionLabel(outcome)} for ${outcome.task.id}.`, {
      id,
      description: `${outcome.message} ${nextStep}`,
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
        toast.info(`Autopilot skipped ${actionLabel(outcome)} for ${outcome.task.id}.`, {
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
      toast.error("Autopilot cannot evaluate task changes.", {
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
