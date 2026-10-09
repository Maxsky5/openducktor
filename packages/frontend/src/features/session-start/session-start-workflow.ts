import type {
  WorkflowLaunchRequest,
  WorkflowLaunchRef,
  WorkflowLaunchSnapshot,
  WorkflowLaunchDecision,
} from "@openducktor/contracts";
import type {
  AgentMessageSendReceipt,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { host } from "@/state/operations/shared/host";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { updateSessionLaunchDraft } from "./session-launch-draft-recovery";

import type { ResolvedSessionStartDecision, SessionStartFlowRequest } from "./session-start-types";
export type { SessionStartBeforeAction, SessionStartPostAction } from "./session-start-types";

export type SessionStartWorkflowResult = AgentSessionIdentity & {
  postStartActionError: Error | null;
  retryPostStartMessage?: () => Promise<void>;
  postStartMessageReceipt?: AgentMessageSendReceipt;
};

export type WorkflowLaunchClient = Pick<
  typeof host,
  | "agentSessionWorkflowLaunch"
  | "agentSessionWorkflowLaunchRecover"
  | "agentSessionWorkflowLaunchRead"
>;

type StartSessionWorkflowArgs = {
  request: SessionStartFlowRequest;
  decision: ResolvedSessionStartDecision;
  workspaceId: string;
  repoPath: string;
  launchAttemptId: string;
  client?: WorkflowLaunchClient;
  readSessionSnapshot?: (identity: AgentSessionIdentity) => AgentSessionState | null;
};

/** The host completes the launch even if the browser leaves or changes its selection. */
export const startSessionWorkflow = async ({
  request,
  decision,
  workspaceId,
  repoPath,
  launchAttemptId,
  client = host,
  readSessionSnapshot,
}: StartSessionWorkflowArgs): Promise<SessionStartWorkflowResult> => {
  request.assertBeforeLaunch?.();
  if (request.assertCanSubmit && decision.startMode === "reuse") {
    const source = readSessionSnapshot?.(decision.sourceSession);
    if (!source)
      throw new Error("The selected session is missing. Reload session data before sending.");
    request.assertCanSubmit(source);
  }
  let hostDecision: WorkflowLaunchDecision;
  if (decision.startMode === "reuse") {
    hostDecision = { startMode: "reuse", sourceSession: decision.sourceSession };
  } else {
    const selection = decision.selectedModel;
    if (!selection.runtimeKind)
      throw new Error("Session start requires a selected runtime and model.");
    const selectedModel = { ...selection, runtimeKind: selection.runtimeKind };
    hostDecision =
      decision.startMode === "fork"
        ? { startMode: "fork", sourceSession: decision.sourceSession, selectedModel }
        : { startMode: "fresh", selectedModel };
  }
  const launch: WorkflowLaunchRequest = {
    launchAttemptId,
    workspaceId,
    repoPath,
    taskId: request.taskId,
    policy: { kind: "manual", actionId: request.launchActionId, decision: hostDecision },
    instruction: { kind: "none" },
  };
  if (request.postStartAction === "send_message")
    launch.instruction = {
      kind: "message",
      parts: request.parts ?? [{ kind: "text", text: request.message ?? "" }],
    };
  if (request.postStartAction === "kickoff") {
    launch.instruction = { kind: "kickoff" };
    if (decision.kickoffPrompt !== undefined) launch.instruction.text = decision.kickoffPrompt;
    if (request.message) launch.instruction.feedback = request.message;
  }
  if (decision.targetBranch) launch.targetBranch = decision.targetBranch;
  if (request.targetWorkingDirectory)
    launch.targetWorkingDirectory = request.targetWorkingDirectory;
  if (request.beforeStartAction) launch.beforeStartAction = request.beforeStartAction;
  if (decision.startMode === "fresh" && request.queueIfBusy) launch.queueIfBusy = true;
  const ref = { launchAttemptId, workspaceId, repoPath, taskId: request.taskId };
  const result = workflowLaunchResult(await submitWorkflowLaunch(launch, client), ref, client);
  const recover = result.retryPostStartMessage;
  if (recover && (request.assertBeforeLaunch || request.assertCanSubmit))
    result.retryPostStartMessage = async () => {
      request.assertBeforeLaunch?.();
      if (request.assertCanSubmit) {
        const session = readSessionSnapshot?.(result);
        if (!session)
          throw new Error("The selected session is missing. Reload session data before sending.");
        request.assertCanSubmit(session);
      }
      await recover();
    };
  return result;
};

export const submitWorkflowLaunch = async (
  request: WorkflowLaunchRequest,
  client: Pick<
    WorkflowLaunchClient,
    "agentSessionWorkflowLaunch" | "agentSessionWorkflowLaunchRead"
  >,
): Promise<WorkflowLaunchSnapshot> => {
  const { launchAttemptId, workspaceId, repoPath, taskId } = request;
  const ref = { launchAttemptId, workspaceId, repoPath, taskId };
  let outcome: WorkflowLaunchSnapshot;
  try {
    outcome = await client.agentSessionWorkflowLaunch(request);
  } catch (cause) {
    let retained: WorkflowLaunchSnapshot | undefined;
    try {
      [retained] = await client.agentSessionWorkflowLaunchRead(ref);
    } catch (readCause) {
      throw new WorkflowLaunchObservationError(
        ref,
        cause instanceof Error ? cause : new Error(String(cause)),
        readCause instanceof Error ? readCause : new Error(String(readCause)),
      );
    }
    if (!retained || ["queued", "preparing", "sending"].includes(retained.phase))
      throw new WorkflowLaunchObservationError(
        ref,
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    outcome = retained;
  }
  return outcome;
};

export const workflowLaunchResult = (
  outcome: WorkflowLaunchSnapshot,
  ref: WorkflowLaunchRef,
  client: Pick<WorkflowLaunchClient, "agentSessionWorkflowLaunchRecover">,
): SessionStartWorkflowResult => {
  if (!outcome.session || !outcome.ownershipSaved) throw new WorkflowLaunchFailure(outcome);
  const result: SessionStartWorkflowResult = {
    ...outcome.session,
    postStartActionError:
      outcome.failure || outcome.phase === "canceled" ? new WorkflowLaunchFailure(outcome) : null,
  };
  if (outcome.acceptance === "accepted" && outcome.acceptedMessage) {
    result.postStartMessageReceipt = {
      recipient: toAgentSessionIdentity(outcome.session),
      acceptedMessage: outcome.acceptedMessage,
      postAcceptanceFailure: result.postStartActionError?.message ?? null,
    };
  }
  if (outcome.recoveryAllowed === true) {
    result.retryPostStartMessage = async () => {
      const recovered = await client.agentSessionWorkflowLaunchRecover({
        launchAttemptId: ref.launchAttemptId,
        workspaceId: ref.workspaceId,
        repoPath: ref.repoPath,
        taskId: ref.taskId,
      });
      updateSessionLaunchDraft(recovered);
      if (recovered.failure || recovered.phase !== "completed")
        throw new WorkflowLaunchFailure(recovered);
    };
  }
  return result;
};

export class WorkflowLaunchFailure extends Error {
  constructor(readonly outcome: WorkflowLaunchSnapshot) {
    const message =
      outcome.failure?.message ??
      outcome.skipReason ??
      (outcome.phase === "canceled"
        ? "Workflow launch was canceled."
        : "Workflow launch did not complete.");
    const cleanup = outcome.failure?.cleanupErrors ?? [];
    const guidance =
      outcome.acceptance === "unknown"
        ? " Runtime acceptance is unknown. Inspect the saved session before sending another instruction."
        : "";
    super(message + (cleanup.length ? ` Cleanup failed: ${cleanup.join("; ")}` : "") + guidance);
    this.name = "WorkflowLaunchFailure";
  }
}

/** Keep the attempt ID for inspection after reconnect. This error does not permit another send. */
export class WorkflowLaunchObservationError extends Error {
  constructor(
    readonly launch: WorkflowLaunchRef,
    readonly transportCause: Error,
    readonly readCause?: Error,
  ) {
    super(
      `${transportCause.message}. Inspect workflow launch '${launch.launchAttemptId}' after reconnect before sending another instruction.`,
      { cause: transportCause },
    );
    this.name = "WorkflowLaunchObservationError";
  }
}
