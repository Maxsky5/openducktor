import type { AutopilotActionId, TaskCard, WorkflowLaunchRequest } from "@openducktor/contracts";
import {
  type WorkflowLaunchClient,
  WorkflowLaunchFailure,
} from "../session-start/session-start-workflow";
import { host } from "@/state/operations/shared/host";
import { AUTOPILOT_ACTION_DEFINITIONS } from "./autopilot-catalog";
import type { ActiveWorkspace } from "@/types/state-slices";
import type {
  SessionStartNotificationPublisher,
  SessionStartNotificationInput,
} from "../session-start/session-start-orchestration";
import {
  publishSessionStartError,
  SessionStartWorkflowError,
} from "../session-start/session-start-orchestration";

/** The host applies the start rules. Autopilot reports the result. */
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
  client?: WorkflowLaunchClient;
  notifications?: SessionStartNotificationPublisher;
}) => {
  const request: WorkflowLaunchRequest = {
    workspaceId: activeWorkspace.workspaceId,
    repoPath: activeWorkspace.repoPath,
    taskId: task.id,
    policy: { kind: "automatic", actionId },
    instruction: { kind: "kickoff" },
  };
  const action = AUTOPILOT_ACTION_DEFINITIONS[actionId];
  const notification: SessionStartNotificationInput = {
    launchAttemptId: crypto.randomUUID(),
    workspaceId: request.workspaceId,
    taskId: task.id,
    taskTitle: task.title,
    role: action.role,
  };
  const reportFailure = (cause: unknown): void => {
    try {
      notifications?.reportFailure(cause, notification);
    } catch (reportCause) {
      console.error("Cannot report the Autopilot notification failure.", reportCause);
    }
  };
  const outcome = await client.agentSessionWorkflowLaunch(request);
  if (outcome.status === "skipped")
    return { kind: "skipped" as const, message: outcome.skipReason ?? "Workflow launch skipped." };
  if (outcome.status !== "completed") {
    const failure = new WorkflowLaunchFailure(outcome);
    const notificationInput: SessionStartNotificationInput = { ...notification };
    if (outcome.session) notificationInput.session = outcome.session;
    const handled = await publishSessionStartError(
      notifications,
      notificationInput,
      failure,
      reportFailure,
    );
    const error = new SessionStartWorkflowError(failure, handled);
    if (!outcome.session) throw error;
    return {
      kind: "started" as const,
      message: `Started ${action.label} for ${task.id}.`,
      postStartActionError: error,
    };
  }
  if (outcome.session && (outcome.startMode === "fresh" || outcome.startMode === "fork")) {
    try {
      notifications?.publishSessionStarted({ ...notification, session: outcome.session });
    } catch (cause) {
      reportFailure(cause);
    }
  }
  return {
    kind: "started" as const,
    message: `Started ${action.label} for ${task.id}.`,
    postStartActionError: null,
  };
};
