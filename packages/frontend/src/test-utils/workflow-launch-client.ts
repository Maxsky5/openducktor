import { getSessionLaunchAction, type AgentUserMessagePart } from "@openducktor/core";
import type { WorkflowLaunchRequest, WorkflowLaunchSnapshot } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { StartAgentSession } from "@/types/agent-session-start";
import {
  createSessionStartWorkflowRunner as createRunner,
  type RunSessionStartWorkflow,
} from "@/features/session-start/session-start-orchestration";
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

type FixtureArgs = {
  queryClient: QueryClient;
  workspaceId: string | null;
  startAgentSession: StartAgentSession;
  sendAgentMessage?: SendAgentMessage;
  notifications?: Parameters<typeof createRunner>[0]["notifications"];
  createLaunchAttemptId?: () => string;
  onRequest?: (request: WorkflowLaunchRequest) => void;
};

/** Adapt UI test controls to a fake host. Host tests cover launch policy. */
export const createWorkflowLaunchClient = (
  args: FixtureArgs,
): NonNullable<Parameters<typeof createRunner>[0]["client"]> => {
  let retained: WorkflowLaunchSnapshot;
  let retainedParts: AgentUserMessagePart[] = [];
  let retainedSendOptions: Parameters<SendAgentMessage>[2];
  const launch = async (request: WorkflowLaunchRequest): Promise<WorkflowLaunchSnapshot> => {
    if (request.policy.kind !== "manual")
      throw new Error("This UI fixture requires a manual request.");
    args.onRequest?.(request);
    const role = getSessionLaunchAction(request.policy.actionId).role;
    const parts =
      request.instruction.kind === "none"
        ? undefined
        : request.instruction.kind === "message"
          ? request.instruction.parts.map((part): AgentUserMessagePart => {
              if (part.kind !== "attachment") return part;
              if (!part.attachment.mime)
                throw new Error("UI fixture requires an attachment MIME type.");
              return { ...part, attachment: { ...part.attachment, mime: part.attachment.mime } };
            })
          : [{ kind: "text" as const, text: request.instruction.text ?? "Host kickoff" }];
    const decision = request.policy.decision;
    let session;
    try {
      const startInput: Parameters<StartAgentSession>[0] = {
        taskId: request.taskId,
        role: role,
        ...decision,
      };
      if (startInput.startMode === "fresh") {
        if (request.targetWorkingDirectory)
          startInput.targetWorkingDirectory = request.targetWorkingDirectory;
        if (request.queueIfBusy) startInput.queueIfBusy = true;
      }
      session = await args.startAgentSession(startInput);
    } catch (cause) {
      retained = {
        launchAttemptId: request.launchAttemptId,
        workspaceId: request.workspaceId,
        repoPath: request.repoPath,
        taskId: request.taskId,
        role: role,
        phase: "failed",
        acceptance: "not_submitted",
        ownershipSaved: false,
        completedPreStartActions: [],
        failure: {
          message: cause instanceof Error ? cause.message : String(cause),
          stage: "session",
          cleanupErrors: [],
        },
      };
      return retained;
    }
    retained = {
      launchAttemptId: request.launchAttemptId,
      workspaceId: request.workspaceId,
      repoPath: request.repoPath,
      taskId: request.taskId,
      role: role,
      phase: "completed",
      acceptance: parts === undefined ? "not_submitted" : "accepted",
      ownershipSaved: true,
      completedPreStartActions: [],
      session: { ...session, startedAt: "2026-03-01T00:00:00.000Z", status: "idle" },
    };
    if (parts !== undefined) {
      retainedParts = parts;
      retainedSendOptions = { errorAttentionId: request.launchAttemptId };
      if (request.instruction.kind === "kickoff" && request.instruction.text !== undefined)
        retainedSendOptions.preserveTextWhitespace = true;
      try {
        if (request.instruction.kind === "message") await args.sendAgentMessage?.(session, parts);
        else await args.sendAgentMessage?.(session, parts, retainedSendOptions);
      } catch (cause) {
        retained.phase = "failed";
        retained.acceptance = "rejected";
        retained.recoveryAllowed = true;
        retained.failure = {
          message: cause instanceof Error ? cause.message : String(cause),
          stage: "send",
          cleanupErrors: [],
        };
      }
    }
    return retained;
  };
  return {
    agentSessionWorkflowLaunch: launch,
    agentSessionWorkflowLaunchRead: async () => (retained ? [retained] : []),
    agentSessionWorkflowLaunchRecover: async () => {
      if (retained.session)
        await args.sendAgentMessage?.(
          {
            externalSessionId: retained.session.externalSessionId,
            runtimeKind: retained.session.runtimeKind,
            workingDirectory: retained.session.workingDirectory,
          },
          retainedParts,
          retainedSendOptions,
        );
      return { ...retained, phase: "completed", acceptance: "accepted", failure: undefined };
    },
  };
};

export const createSessionStartWorkflowRunner = (args: FixtureArgs): RunSessionStartWorkflow => {
  const runnerArgs: Parameters<typeof createRunner>[0] = {
    workspaceId: args.workspaceId ?? "workspace-1",
    repoPath: "/repo",
    client: createWorkflowLaunchClient(args),
  };
  if (args.notifications) runnerArgs.notifications = args.notifications;
  if (args.createLaunchAttemptId) runnerArgs.createLaunchAttemptId = args.createLaunchAttemptId;
  return createRunner(runnerArgs);
};
