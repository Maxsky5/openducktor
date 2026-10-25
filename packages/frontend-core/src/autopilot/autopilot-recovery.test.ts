import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionUserMessagePart,
  AutopilotRecoveryClaimInput,
  WorkflowLaunchResult,
} from "@openducktor/contracts";
import type { AgentMessageSendReceipt, AgentSessionIdentity } from "../types/agent-orchestrator";
import {
  AUTOPILOT_MESSAGE_UNKNOWN_DESCRIPTION,
  type AutopilotFailedOutcome,
  type AutopilotRecovery,
  type AutopilotRecoveryPorts,
  createAutopilotRecovery,
  retryAutopilotRecovery,
} from "./autopilot-recovery";

const identity: AgentSessionIdentity = {
  externalSessionId: "session-1",
  runtimeKind: "codex",
  workingDirectory: "/worktrees/task-1",
};
const instruction = (): AgentSessionUserMessagePart[] => [{ kind: "text", text: "Kickoff" }];
const launch = (patch: Partial<WorkflowLaunchResult> = {}): WorkflowLaunchResult => ({
  workspaceId: "alpha",
  repoPath: "/repos/alpha",
  taskId: "task-1",
  role: "build",
  status: "failed",
  ...patch,
});
const failed = (launchResult?: WorkflowLaunchResult): AutopilotFailedOutcome => {
  const outcome: AutopilotFailedOutcome = {
    workspaceId: "alpha",
    repoPath: "/repos/alpha",
    task: { id: "task-1", title: "Task" },
    eventId: "taskRejectedByQa",
    actionId: "startReviewQaFeedbacks",
    occurredAt: "2026-10-10T00:00:00.000Z",
    outcomeId: "failed-1",
    kind: "failed",
    message: "The model is not available.",
  };
  if (launchResult) outcome.launch = launchResult;
  return outcome;
};
const recoverable = (): AutopilotRecovery => {
  const recovery = createAutopilotRecovery(
    failed(
      launch({
        session: {
          ...identity,
          startedAt: "2026-10-10T00:00:00.000Z",
          status: "idle",
        },
        unsentInstruction: instruction(),
      }),
    ),
  );
  if (!recovery) throw new Error("The launch has no recovery.");
  return recovery;
};

const createPorts = () => {
  const claims: AutopilotRecoveryClaimInput[] = [];
  const ports = {
    claimRecovery: mock(async (input: AutopilotRecoveryClaimInput) => {
      claims.push(input);
      return { claimed: true };
    }),
    sendMessage: mock(
      async (
        session: AgentSessionIdentity,
        _parts: AgentSessionUserMessagePart[],
      ): Promise<AgentMessageSendReceipt | null> => ({ outcome: "queued", recipient: session }),
    ),
    isWorkspaceSelected: mock((workspaceId: string): boolean => workspaceId === "alpha"),
  } satisfies AutopilotRecoveryPorts;
  return { ports, claims };
};

describe("Autopilot first-message recovery", () => {
  test("exists only for a launch with a session and an unsent first message", () => {
    expect(createAutopilotRecovery(failed())).toBeNull();
    expect(
      createAutopilotRecovery(failed(launch({ unsentInstruction: instruction() }))),
    ).toBeNull();
    expect(recoverable()).toMatchObject({
      session: identity,
      instruction: instruction(),
      message: "The model is not available.",
      claimed: false,
      pending: false,
      done: false,
    });
  });

  test("claims once, keeps the claim after a failed send, and sends again", async () => {
    const { ports, claims } = createPorts();
    ports.sendMessage.mockImplementationOnce(async () => {
      throw new Error("Runtime is busy.");
    });
    const recovery = recoverable();

    expect(await retryAutopilotRecovery(recovery, ports)).toBe("failed");
    expect(recovery).toMatchObject({ message: "Runtime is busy.", claimed: true, done: false });
    expect(await retryAutopilotRecovery(recovery, ports)).toBe("sent");

    expect(claims).toEqual([{ workspaceId: "alpha", outcomeId: "failed-1" }]);
    expect(ports.sendMessage.mock.calls).toEqual([
      [identity, instruction()],
      [identity, instruction()],
    ]);
    expect(await retryAutopilotRecovery(recovery, ports)).toBe("ignored");
    expect(ports.sendMessage).toHaveBeenCalledTimes(2);
  });

  test("does nothing while a claim or send runs", async () => {
    const { ports } = createPorts();
    const send = Promise.withResolvers<AgentMessageSendReceipt | null>();
    ports.sendMessage.mockImplementationOnce(() => send.promise);
    const recovery = recoverable();

    const first = retryAutopilotRecovery(recovery, ports);
    expect(await retryAutopilotRecovery(recovery, ports)).toBe("ignored");
    send.resolve(null);
    expect(await first).toBe("sent");
    expect(ports.claimRecovery).toHaveBeenCalledTimes(1);
    expect(ports.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("ends with an unknown result when the send result is lost", async () => {
    const { ports } = createPorts();
    ports.sendMessage.mockImplementationOnce(async (session) => ({
      outcome: "uncertain",
      recipient: session,
      submissionId: "submission-1",
    }));
    const recovery = recoverable();

    expect(await retryAutopilotRecovery(recovery, ports)).toBe("unknown");
    expect(recovery).toMatchObject({ done: true, message: AUTOPILOT_MESSAGE_UNKNOWN_DESCRIPTION });
    expect(await retryAutopilotRecovery(recovery, ports)).toBe("ignored");
    expect(ports.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("asks for the workspace before a first claim from another workspace", async () => {
    const { ports, claims } = createPorts();
    ports.isWorkspaceSelected.mockImplementation(() => false);
    const recovery = recoverable();

    expect(await retryAutopilotRecovery(recovery, ports)).toBe("workspace_not_selected");
    expect(recovery.message).toBe("Select the workspace of task-1, then retry the message.");
    expect(claims).toEqual([]);
    expect(ports.sendMessage).not.toHaveBeenCalled();
  });

  test("asks for the workspace before a send that follows a claim", async () => {
    const { ports, claims } = createPorts();
    ports.sendMessage.mockImplementationOnce(async () => {
      throw new Error("Runtime is busy.");
    });
    const recovery = recoverable();
    expect(await retryAutopilotRecovery(recovery, ports)).toBe("failed");

    ports.isWorkspaceSelected.mockImplementation(() => false);
    expect(await retryAutopilotRecovery(recovery, ports)).toBe("workspace_not_selected");
    expect(recovery.message).toBe("Select the workspace of task-1, then retry the message.");
    expect(ports.sendMessage).toHaveBeenCalledTimes(1);

    ports.isWorkspaceSelected.mockImplementation(() => true);
    expect(await retryAutopilotRecovery(recovery, ports)).toBe("sent");
    expect(claims).toHaveLength(1);
  });

  test("ends without a send when another client holds the claim", async () => {
    const { ports } = createPorts();
    ports.claimRecovery.mockImplementationOnce(async () => ({ claimed: false }));
    const recovery = recoverable();

    expect(await retryAutopilotRecovery(recovery, ports)).toBe("not_claimed");
    expect(recovery.done).toBe(true);
    expect(ports.sendMessage).not.toHaveBeenCalled();
  });
});
