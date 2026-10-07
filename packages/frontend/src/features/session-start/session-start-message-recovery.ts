import { toast, type ExternalToast } from "sonner";
import {
  WorkflowLaunchFailure,
  workflowLaunchResult,
  type WorkflowLaunchClient,
  type SessionStartWorkflowResult,
} from "./session-start-workflow";
import type { WorkflowLaunchSnapshot } from "@openducktor/contracts";
import { updateSessionLaunchDraft } from "./session-launch-draft-recovery";

/** Share one toast between immediate results and later updates. */
export const presentWorkflowLaunchOutcome = (
  outcome: WorkflowLaunchSnapshot,
  client: Pick<WorkflowLaunchClient, "agentSessionWorkflowLaunchRecover">,
): boolean => {
  updateSessionLaunchDraft(outcome);
  const id = toastId(outcome);
  if (outcome.phase !== "failed") {
    toast.dismiss(id);
    return false;
  }
  if (outcome.session && outcome.ownershipSaved && outcome.recoveryAllowed) {
    showSessionStartMessageRecovery(workflowLaunchResult(outcome, outcome, client));
  } else {
    toast.error(`Workflow launch failed for ${outcome.taskId}.`, {
      id,
      description: new WorkflowLaunchFailure(outcome).message,
      duration: Infinity,
      action: undefined,
    });
  }
  return true;
};

export const showSessionStartMessageRecovery = (result: SessionStartWorkflowResult): void => {
  const retry = result.retryPostStartMessage;
  if (!retry || !result.postStartActionError) return;
  const outcome =
    result.postStartActionError instanceof WorkflowLaunchFailure
      ? result.postStartActionError.outcome
      : undefined;
  const id = outcome ? toastId(outcome) : undefined;
  const options: ExternalToast = {
    description: result.postStartActionError.message,
    duration: Infinity,
    classNames: {
      toast: "!flex-col !items-stretch",
      content: "w-full",
      actionButton: "!m-0 !h-9 !w-full !rounded-md justify-center",
    },
    action: {
      label: "Retry message",
      onClick: () => {
        void retry()
          .then(() => {
            if (id !== undefined) toast.dismiss(id);
          })
          .catch((cause) => {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            if (!(cause instanceof WorkflowLaunchFailure) || !cause.outcome.recoveryAllowed) {
              const failureOptions: ExternalToast = {
                description: error.message,
                action: undefined,
              };
              if (id !== undefined) failureOptions.id = id;
              toast.error("First message recovery failed.", failureOptions);
              return;
            }
            showSessionStartMessageRecovery({ ...result, postStartActionError: error });
          });
      },
    },
  };
  if (id !== undefined) options.id = id;
  const title = outcome
    ? `First message failed for ${outcome.taskId}.`
    : "Session started, but the first message failed.";
  toast.error(title, options);
};

const toastId = (outcome: WorkflowLaunchSnapshot): string =>
  JSON.stringify([
    "workflow-launch",
    outcome.workspaceId,
    outcome.repoPath,
    outcome.taskId,
    outcome.launchAttemptId,
  ]);
