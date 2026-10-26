import type {
  AgentSessionUserMessagePart,
  WorkflowLaunchDecision,
  WorkflowLaunchRequest,
  WorkflowLaunchResult,
} from "@openducktor/contracts";
import { sessionLaunchFailureMessage, type AgentUserMessagePart } from "@openducktor/core";
import type {
  AgentMessageSendOptions,
  AgentMessageSendReceipt,
  AcceptedAgentMessageSendReceipt,
  AgentSessionIdentity,
} from "../../types/agent-orchestrator";
import type { AgentOperationsContextValue } from "../../types/session-slices";
import { toAgentSessionIdentity } from "../../lib/agent-session-identity";
import type { ResolvedSessionStartDecision, SessionStartFlowRequest } from "./session-start-types";
import type { HostClient } from "@openducktor/host-client";
export type { SessionStartBeforeAction, SessionStartPostAction } from "./session-start-types";

export type SendAgentMessage = AgentOperationsContextValue["sendAgentMessage"];

export type SessionStartWorkflowResult = AgentSessionIdentity & {
  postStartActionError: Error | null;
  /**
   * Sends the unsent first instruction again and returns the send receipt. It does nothing and
   * returns null while a send runs or after a send. An `uncertain` receipt also ends the retries,
   * because the host can have the message.
   */
  retryPostStartMessage?: () => Promise<AgentMessageSendReceipt | null>;
  postStartMessageReceipt?: AcceptedAgentMessageSendReceipt;
};

export type WorkflowLaunchClient = Pick<HostClient, "agentSessionWorkflowLaunch">;

type StartSessionWorkflowArgs = {
  request: SessionStartFlowRequest;
  decision: ResolvedSessionStartDecision;
  workspaceId: string;
  repoPath: string;
  client: WorkflowLaunchClient;
  sendAgentMessage: SendAgentMessage;
};

/** The host completes the launch even if the browser leaves or changes its selection. */
export const startSessionWorkflow = async ({
  request,
  decision,
  workspaceId,
  repoPath,
  client,
  sendAgentMessage,
}: StartSessionWorkflowArgs): Promise<SessionStartWorkflowResult> => {
  request.assertBeforeLaunch?.();
  const launch: WorkflowLaunchRequest = {
    workspaceId,
    repoPath,
    taskId: request.taskId,
    policy: {
      kind: "manual",
      actionId: request.launchActionId,
      decision: toWorkflowLaunchDecision(request, decision),
    },
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
  if (request.beforeStartAction) launch.beforeStartAction = request.beforeStartAction;
  const outcome = await client.agentSessionWorkflowLaunch(launch);
  if (!outcome.session) throw new WorkflowLaunchFailure(outcome);
  const session = toAgentSessionIdentity(outcome.session);
  const result: SessionStartWorkflowResult = {
    ...session,
    postStartActionError:
      outcome.status === "completed" ? null : new WorkflowLaunchFailure(outcome),
  };
  if (outcome.acceptedMessage)
    result.postStartMessageReceipt = {
      outcome: "accepted",
      recipient: session,
      acceptedMessage: outcome.acceptedMessage,
      postAcceptanceFailure: result.postStartActionError?.message ?? null,
    };
  const unsentInstruction = outcome.unsentInstruction
    ? toAgentUserMessageParts(outcome.unsentInstruction)
    : null;
  if (unsentInstruction) {
    let sent = false;
    let pending = false;
    result.retryPostStartMessage = async () => {
      if (pending || sent) return null;
      pending = true;
      try {
        const options: AgentMessageSendOptions = {};
        const { assertBeforeLaunch, assertCanSubmit } = request;
        if (assertBeforeLaunch || assertCanSubmit)
          options.assertCanSubmit = (recipient) => {
            assertBeforeLaunch?.();
            assertCanSubmit?.(recipient);
          };
        if (request.postStartAction === "kickoff") options.preserveTextWhitespace = true;
        const receipt = await sendAgentMessage(session, unsentInstruction, options);
        sent = receipt !== null;
        return receipt;
      } finally {
        pending = false;
      }
    };
  }
  return result;
};

export const toAgentUserMessageParts = (
  parts: AgentSessionUserMessagePart[],
): AgentUserMessagePart[] =>
  // SAFETY: Parsed host results never hold an explicit undefined field, which is the only
  // difference between the contract parts and the core parts.
  parts as AgentUserMessagePart[];

const toWorkflowLaunchDecision = (
  request: SessionStartFlowRequest,
  decision: ResolvedSessionStartDecision,
): WorkflowLaunchDecision => {
  if (decision.startMode === "reuse") {
    const reuse: Extract<WorkflowLaunchDecision, { startMode: "reuse" }> = {
      startMode: "reuse",
      sourceSession: decision.sourceSession,
    };
    if (decision.speed !== undefined) reuse.speed = decision.speed;
    return reuse;
  }
  const { runtimeKind } = decision.selectedModel;
  if (!runtimeKind) throw new Error("Session start requires a selected runtime and model.");
  const selectedModel = { ...decision.selectedModel, runtimeKind };
  if (decision.startMode === "fork")
    return { startMode: "fork", sourceSession: decision.sourceSession, selectedModel };
  const fresh: WorkflowLaunchDecision = { startMode: "fresh", selectedModel };
  if (request.targetWorkingDirectory) fresh.targetWorkingDirectory = request.targetWorkingDirectory;
  return fresh;
};

export class WorkflowLaunchFailure extends Error {
  constructor(readonly outcome: WorkflowLaunchResult) {
    super(workflowLaunchFailureMessage(outcome));
    this.name = "WorkflowLaunchFailure";
  }
}

const workflowLaunchFailureMessage = (outcome: WorkflowLaunchResult): string => {
  if (outcome.failure) return sessionLaunchFailureMessage(outcome.failure);
  if (outcome.skipReason !== undefined) return outcome.skipReason;
  if (outcome.status === "canceled") return "Workflow launch was canceled.";
  return "Workflow launch returned no saved session.";
};

/** The session notice of a failure that the host showed in the session and notified. */
export const hostLaunchNoticeId = (cause: Error): string | undefined =>
  cause instanceof WorkflowLaunchFailure ? cause.outcome.failure?.noticeId : undefined;
