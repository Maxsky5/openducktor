import type { AutopilotActionId, TaskCard, WorkflowLaunchRequest } from "@openducktor/contracts";
import {
  submitWorkflowLaunch,
  WorkflowLaunchFailure,
} from "../session-start/session-start-workflow";
import { presentWorkflowLaunchOutcome } from "../session-start/session-start-message-recovery";
import { host } from "@/state/operations/shared/host";
import { AUTOPILOT_ACTION_DEFINITIONS } from "./autopilot-catalog";
import type { ActiveWorkspace } from "@/types/state-slices";
import type {
  SessionStartNotificationPublisher,
  SessionStartNotificationInput,
} from "../session-start/session-start-orchestration";
import { SessionStartWorkflowError } from "../session-start/session-start-orchestration";

export const executeAutopilotAction = async ({
  activeWorkspace,
  task,
  actionId,
  client = host,
  notifications,
}: {
  activeWorkspace: ActiveWorkspace;
  task: Pick<TaskCard, "id" | "title">;
  actionId: AutopilotActionId;
  client?: Pick<
    typeof host,
    | "agentSessionWorkflowLaunch"
    | "agentSessionWorkflowLaunchRead"
    | "agentSessionWorkflowLaunchRecover"
  >;
  notifications?: SessionStartNotificationPublisher;
}) => {
  const request: WorkflowLaunchRequest = {
    launchAttemptId: crypto.randomUUID(),
    workspaceId: activeWorkspace.workspaceId,
    repoPath: activeWorkspace.repoPath,
    taskId: task.id,
    policy: { kind: "automatic", actionId },
    instruction: { kind: "kickoff" },
  };
  const action = AUTOPILOT_ACTION_DEFINITIONS[actionId];
  const notification = {
    launchAttemptId: request.launchAttemptId,
    workspaceId: request.workspaceId,
    taskId: task.id,
    taskTitle: task.title,
    role: action.role,
  };
  const reportFailure = (cause: unknown, message: string): void => {
    try {
      notifications?.reportFailure(cause, notification);
    } catch (reportCause) {
      console.error(message, reportCause);
    }
  };
  const outcome = await submitWorkflowLaunch(request, client);
  if (outcome.phase === "skipped")
    return { kind: "skipped" as const, message: outcome.skipReason ?? "Workflow launch skipped." };
  if (outcome.failure || outcome.phase === "canceled") {
    const failure = new WorkflowLaunchFailure(outcome);
    const message = failure.message;
    let handled = false;
    try {
      handled = presentWorkflowLaunchOutcome(outcome, client);
    } catch (cause) {
      reportFailure(cause, "Cannot report workflow presentation failure.");
    }
    try {
      const notificationInput: SessionStartNotificationInput = {
        ...notification,
        inAppFeedbackHandled: handled,
      };
      if (outcome.session) notificationInput.session = outcome.session;
      const published =
        (await notifications?.publishSessionError(notificationInput, message)) ?? false;
      handled ||= published;
    } catch (cause) {
      reportFailure(cause, "Cannot report workflow notification failure.");
    }
    const error = new SessionStartWorkflowError(failure, handled);
    if (!outcome.ownershipSaved) throw error;
    return {
      kind: "started" as const,
      message: `Started ${action.label} for ${task.id}.`,
      postStartActionError: error,
    };
  }
  if (outcome.session) {
    try {
      notifications?.publishSessionStarted({ ...notification, session: outcome.session });
    } catch (cause) {
      reportFailure(cause, "Cannot report workflow notification failure.");
    }
  }
  return {
    kind: "started" as const,
    message: `Started ${action.label} for ${task.id}.`,
    postStartActionError: null,
  };
};
