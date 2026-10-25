import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  AgentSessionUserMessagePart,
  AutopilotOutcome,
  AutopilotRecoveryClaimInput,
  WorkflowLaunchResult,
} from "@openducktor/contracts";
import { toast } from "sonner";
import type {
  AgentMessageSendReceipt,
  AgentSessionIdentity,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  type AutopilotOutcomePresenterPorts,
  createAutopilotOutcomePresenter,
} from "./autopilot-outcome-presenter";

const session = {
  externalSessionId: "session-1",
  runtimeKind: "codex" as const,
  workingDirectory: "/worktrees/task-1",
  startedAt: "2026-10-10T00:00:00.000Z",
  status: "idle" as const,
};
const launch = (patch: Partial<WorkflowLaunchResult> = {}): WorkflowLaunchResult => ({
  workspaceId: "alpha",
  repoPath: "/repos/alpha",
  taskId: "task-1",
  role: "build",
  status: "failed",
  ...patch,
});
const fields = {
  workspaceId: "alpha",
  repoPath: "/repos/alpha",
  task: { id: "task-1", title: "Task" },
  eventId: "taskRejectedByQa" as const,
  actionId: "startReviewQaFeedbacks" as const,
  occurredAt: "2026-10-10T00:00:00.000Z",
};
const skipped = (outcomeId = "skipped-1", workspaceId = "alpha"): AutopilotOutcome => ({
  ...fields,
  workspaceId,
  outcomeId,
  kind: "skipped",
  reason: "The task moved to Blocked / Needs Input before the action started.",
});
type FailedOutcome = Extract<AutopilotOutcome, { kind: "failed" }>;
const failed = (launchResult?: WorkflowLaunchResult): FailedOutcome => {
  const outcome: FailedOutcome = {
    ...fields,
    outcomeId: "failed-1",
    kind: "failed",
    message: "The model is not available.",
  };
  if (launchResult) outcome.launch = launchResult;
  return outcome;
};

const createPorts = () => {
  const claims: AutopilotRecoveryClaimInput[] = [];
  const sends: Array<[AgentSessionIdentity, AgentSessionUserMessagePart[]]> = [];
  const ports = {
    claimRecovery: mock(async (input: AutopilotRecoveryClaimInput) => {
      claims.push(input);
      return { claimed: true };
    }),
    sendMessage: mock(
      async (
        identity: AgentSessionIdentity,
        instruction: AgentSessionUserMessagePart[],
      ): Promise<AgentMessageSendReceipt | null> => {
        sends.push([identity, instruction]);
        return { outcome: "queued", recipient: identity };
      },
    ),
    markInAppFeedbackHandled: mock((_errorId: string) => {}),
    isWorkspaceSelected: mock((workspaceId: string) => workspaceId === "alpha"),
    refreshTaskViews: mock(async (_repoPath: string, _taskId: string) => {}),
  } satisfies AutopilotOutcomePresenterPorts;
  return { ports, claims, sends };
};

type ToastCall = Parameters<typeof toast.error>;
const clickAction = (call: ToastCall | undefined): void => {
  const action = call?.[1]?.action;
  if (!(action instanceof Object) || !("onClick" in action))
    throw new Error("The toast has no action.");
  // SAFETY: The presenter's toast actions ignore their click event.
  action.onClick({} as Parameters<typeof action.onClick>[0]);
};
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let info: ReturnType<typeof spyOn<typeof toast, "info">>;
let error: ReturnType<typeof spyOn<typeof toast, "error">>;
let dismiss: ReturnType<typeof spyOn<typeof toast, "dismiss">>;
let warning: ReturnType<typeof spyOn<typeof toast, "warning">>;
beforeEach(() => {
  warning = spyOn(toast, "warning").mockReturnValue("warning");
  info = spyOn(toast, "info").mockReturnValue("info");
  error = spyOn(toast, "error").mockReturnValue("error");
  dismiss = spyOn(toast, "dismiss").mockReturnValue("dismiss");
});
afterEach(() => {
  warning.mockRestore();
  info.mockRestore();
  error.mockRestore();
  dismiss.mockRestore();
});

describe("Autopilot outcome presenter", () => {
  test("shows a skipped outcome once with its reason", () => {
    const { ports } = createPorts();
    const presenter = createAutopilotOutcomePresenter(ports);

    presenter.present(skipped());
    presenter.present(skipped());

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("Autopilot skipped Start Review QA Feedbacks for task-1.", {
      id: "autopilot:skipped-1",
      description: "The task moved to Blocked / Needs Input before the action started.",
    });
    expect(ports.refreshTaskViews).not.toHaveBeenCalled();
  });

  test("a started outcome shows no toast and refreshes the task views", () => {
    const { ports } = createPorts();
    const presenter = createAutopilotOutcomePresenter(ports);

    presenter.present({
      ...fields,
      outcomeId: "started-1",
      kind: "started",
      launch: launch({ status: "completed", session }),
    });

    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(ports.refreshTaskViews).toHaveBeenCalledWith("/repos/alpha", "task-1");
  });

  test("a failure without first-message recovery stays until dismissed and names the next step", () => {
    const { ports } = createPorts();
    const presenter = createAutopilotOutcomePresenter(ports);

    presenter.present(failed());

    expect(error).toHaveBeenCalledWith(
      "Autopilot could not start Start Review QA Feedbacks for task-1.",
      {
        id: "autopilot:failed-1",
        description:
          "The model is not available. Fix the cause, then start the action from the task.",
        duration: Infinity,
      },
    );
    expect(ports.refreshTaskViews).toHaveBeenCalledWith("/repos/alpha", "task-1");
  });

  test("Retry message claims the recovery once and sends the unsent instruction", async () => {
    const { ports, claims, sends } = createPorts();
    const presenter = createAutopilotOutcomePresenter(ports);
    const instruction = [{ kind: "text" as const, text: "Kickoff" }];
    ports.sendMessage.mockImplementationOnce(async () => {
      throw new Error("Runtime is busy.");
    });

    presenter.present(
      failed(
        launch({
          session,
          unsentInstruction: instruction,
          failure: { message: "Rejected", cleanupErrors: [], noticeId: "notice-1" },
        }),
      ),
    );
    expect(ports.markInAppFeedbackHandled).toHaveBeenCalledWith("notice-1");
    expect(error.mock.calls[0]?.[0]).toBe(
      "Autopilot started Start Review QA Feedbacks for task-1, but the first message failed.",
    );
    clickAction(error.mock.calls[0]);
    await flush();
    expect(error.mock.calls[1]?.[1]).toMatchObject({ description: "Runtime is busy." });
    clickAction(error.mock.calls[1]);
    await flush();

    expect(claims).toEqual([{ workspaceId: "alpha", outcomeId: "failed-1" }]);
    const identity: AgentSessionIdentity = {
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/worktrees/task-1",
    };
    // The first send failed, so the second click sent the instruction without a new claim.
    expect(ports.sendMessage.mock.calls).toEqual([
      [identity, instruction],
      [identity, instruction],
    ]);
    expect(sends).toEqual([[identity, instruction]]);
  });

  test("Retry message shows Result unknown when the send result is lost", async () => {
    const { ports } = createPorts();
    ports.sendMessage.mockImplementationOnce(async (recipient) => ({
      outcome: "uncertain",
      recipient,
      submissionId: "submission-1",
    }));
    const presenter = createAutopilotOutcomePresenter(ports);
    presenter.present(
      failed(launch({ session, unsentInstruction: [{ kind: "text", text: "Kickoff" }] })),
    );

    clickAction(error.mock.calls[0]);
    await flush();
    clickAction(error.mock.calls[0]);
    await flush();

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]?.[0]).toBe("Result unknown");
    expect(error).toHaveBeenCalledTimes(1);
    expect(ports.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("Retry message does nothing while a send runs or after a send succeeds", async () => {
    const { ports } = createPorts();
    let finishSend = () => {};
    ports.sendMessage.mockImplementationOnce(
      () =>
        new Promise<AgentMessageSendReceipt | null>((resolve) => {
          finishSend = () => resolve(null);
        }),
    );
    const presenter = createAutopilotOutcomePresenter(ports);
    presenter.present(
      failed(launch({ session, unsentInstruction: [{ kind: "text", text: "Kickoff" }] })),
    );

    clickAction(error.mock.calls[0]);
    clickAction(error.mock.calls[0]);
    await flush();
    clickAction(error.mock.calls[0]);
    finishSend();
    await flush();
    clickAction(error.mock.calls[0]);
    await flush();

    expect(ports.claimRecovery).toHaveBeenCalledTimes(1);
    expect(ports.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("a recoverable failure appears again when its workspace is selected again, until it is recovered", async () => {
    const { ports } = createPorts();
    const presenter = createAutopilotOutcomePresenter(ports);
    const outcome = failed(
      launch({ session, unsentInstruction: [{ kind: "text", text: "Kickoff" }] }),
    );
    const ordinary = { ...failed(), outcomeId: "ordinary" };

    presenter.present(outcome);
    presenter.present(ordinary);
    presenter.present(outcome);
    presenter.present(outcome, { workspaceSelected: true });
    presenter.present(ordinary, { workspaceSelected: true });
    expect(error.mock.calls.map((call) => call[1]?.id)).toEqual([
      "autopilot:failed-1",
      "autopilot:ordinary",
      "autopilot:failed-1",
    ]);

    clickAction(error.mock.calls[2]);
    await flush();
    presenter.present(outcome, { workspaceSelected: true });
    expect(error).toHaveBeenCalledTimes(3);
  });

  test("Retry message from another workspace keeps the recovery for the selected workspace", async () => {
    const { ports, claims, sends } = createPorts();
    const presenter = createAutopilotOutcomePresenter(ports);
    const outcome = failed(
      launch({ session, unsentInstruction: [{ kind: "text", text: "Kickoff" }] }),
    );

    presenter.present({ ...outcome, workspaceId: "beta" });
    clickAction(error.mock.calls[0]);
    await flush();

    expect(claims).toEqual([]);
    expect(sends).toEqual([]);
    expect(error.mock.calls[1]?.[1]).toMatchObject({
      description: "Select the workspace of task-1, then retry the message.",
      action: { label: "Retry message" },
    });
  });

  test("a failure toast closes the in-app toast of the host error notification", () => {
    const { ports } = createPorts();
    const presenter = createAutopilotOutcomePresenter(ports);

    presenter.present({ ...failed(), notificationId: "agent.session_error:autopilot" });

    expect(ports.markInAppFeedbackHandled).toHaveBeenCalledWith("agent.session_error:autopilot");
    expect(error).toHaveBeenCalledTimes(1);
  });

  test("Retry message does not send when another client already claimed the recovery", async () => {
    const { ports, sends } = createPorts();
    ports.claimRecovery.mockImplementationOnce(async () => ({ claimed: false }));
    const presenter = createAutopilotOutcomePresenter(ports);

    presenter.present(
      failed(launch({ session, unsentInstruction: [{ kind: "text", text: "Kickoff" }] })),
    );
    clickAction(error.mock.calls[0]);
    await flush();

    expect(sends).toEqual([]);
    expect(info.mock.calls[0]?.[0]).toBe("Autopilot did not send the message for task-1 again.");
  });

  test("shows and clears the Autopilot failure, and dismisses outcomes of removed workspaces", () => {
    const { ports } = createPorts();
    const presenter = createAutopilotOutcomePresenter(ports);

    presenter.presentFailure("Autopilot could not read the settings. Restart the host.");
    presenter.presentFailure(null);
    presenter.present(skipped("alpha-outcome", "alpha"));
    presenter.present(skipped("beta-outcome", "beta"));
    presenter.keepWorkspaces(new Set(["alpha"]));

    expect(error).toHaveBeenCalledWith("Autopilot cannot evaluate task changes.", {
      id: "autopilot-failure",
      description: "Autopilot could not read the settings. Restart the host.",
      duration: Infinity,
    });
    expect(dismiss.mock.calls).toEqual([["autopilot-failure"], ["autopilot:beta-outcome"]]);
  });
});
