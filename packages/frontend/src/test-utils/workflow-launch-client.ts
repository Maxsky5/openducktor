import {
  getSessionLaunchAction,
  type AgentRole,
  type AgentUserMessagePart,
} from "@openducktor/core";
import {
  type WorkflowLaunchDecision,
  type WorkflowLaunchRequest,
  type WorkflowLaunchResult,
  workflowLaunchRequestSchema,
} from "@openducktor/contracts";
import {
  createSessionStartWorkflowRunner as createRunner,
  type RunSessionStartWorkflow,
} from "@/features/session-start/session-start-orchestration";
import type { WorkflowLaunchClient } from "@/features/session-start/session-start-workflow";
import type {
  AgentMessageSendOptions,
  AgentMessageSendReceipt,
  AgentSessionIdentity,
} from "@/types/agent-orchestrator";

type SendAgentMessage = (
  session: AgentSessionIdentity,
  parts: AgentUserMessagePart[],
  options?: AgentMessageSendOptions,
) => Promise<AgentMessageSendReceipt | null | void>;

type FakeWorkflowStartInput = { taskId: string; role: AgentRole } & WorkflowLaunchDecision;

type FixtureArgs = {
  workspaceId: string | null;
  startAgentSession: (input: FakeWorkflowStartInput) => Promise<AgentSessionIdentity>;
  sendAgentMessage?: SendAgentMessage;
  notifications?: Parameters<typeof createRunner>[0]["notifications"];
  createLaunchAttemptId?: () => string;
  onRequest?: (request: WorkflowLaunchRequest) => void;
};

const acceptedMessage = (parts: AgentUserMessagePart[]) => ({
  type: "user_message" as const,
  externalSessionId: "fake",
  messageId: "fake-message",
  message: parts.map((part) => (part.kind === "text" ? part.text : "")).join(""),
  parts: [],
  timestamp: "2026-03-01T00:00:00.000Z",
  state: "read" as const,
});

/**
 * A fake host for UI tests. It accepts only contract-valid requests. Host tests cover launch
 * policy.
 */
export const createWorkflowLaunchClient = (args: FixtureArgs): WorkflowLaunchClient => ({
  agentSessionWorkflowLaunch: async (input) => {
    const request = workflowLaunchRequestSchema.parse(input);
    if (request.policy.kind !== "manual")
      throw new Error("This UI fixture requires a manual request.");
    args.onRequest?.(request);
    const role = getSessionLaunchAction(request.policy.actionId).role;
    const base: WorkflowLaunchResult = {
      workspaceId: request.workspaceId,
      repoPath: request.repoPath,
      taskId: request.taskId,
      role,
      status: "completed",
      startMode: request.policy.decision.startMode,
    };
    let parts: AgentUserMessagePart[] | undefined;
    if (request.instruction.kind === "kickoff")
      parts = [{ kind: "text", text: request.instruction.text ?? "Host kickoff" }];
    if (request.instruction.kind === "message") {
      // SAFETY: Parsed requests never hold an explicit undefined field, which is the only
      // difference between the contract parts and the core parts.
      parts = request.instruction.parts as AgentUserMessagePart[];
    }
    let session: AgentSessionIdentity;
    try {
      session = await args.startAgentSession({
        taskId: request.taskId,
        role,
        ...request.policy.decision,
      });
    } catch (cause) {
      return {
        ...base,
        status: "failed",
        failure: {
          message: cause instanceof Error ? cause.message : String(cause),
          cleanupErrors: [],
        },
      };
    }
    const result: WorkflowLaunchResult = {
      ...base,
      session: { ...session, startedAt: "2026-03-01T00:00:00.000Z", status: "idle" },
    };
    if (parts === undefined) return result;
    try {
      if (request.instruction.kind === "kickoff" && request.instruction.text !== undefined)
        await args.sendAgentMessage?.(session, parts, { preserveTextWhitespace: true });
      else await args.sendAgentMessage?.(session, parts);
      result.acceptedMessage = acceptedMessage(parts);
    } catch (cause) {
      result.status = "failed";
      result.unsentInstruction = parts;
      // The host reports a failed launch with a saved session in that session.
      result.failure = {
        message: cause instanceof Error ? cause.message : String(cause),
        cleanupErrors: [],
        noticeId: "launch-failure:fake",
      };
    }
    return result;
  },
});

export const createSessionStartWorkflowRunner = (args: FixtureArgs): RunSessionStartWorkflow => {
  const runnerArgs: Parameters<typeof createRunner>[0] = {
    workspaceId: args.workspaceId ?? "workspace-1",
    repoPath: "/repo",
    client: createWorkflowLaunchClient(args),
    sendAgentMessage: async (session, parts, options) =>
      (await args.sendAgentMessage?.(session, parts, options)) ?? null,
  };
  if (args.notifications) runnerArgs.notifications = args.notifications;
  if (args.createLaunchAttemptId) runnerArgs.createLaunchAttemptId = args.createLaunchAttemptId;
  return createRunner(runnerArgs);
};
