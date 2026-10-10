import { expect, mock, test } from "bun:test";
import type { WorkflowLaunchRequest, WorkflowLaunchSnapshot } from "@openducktor/contracts";
import { startSessionWorkflow, WorkflowLaunchFailure } from "./session-start-workflow";
import type { ResolvedSessionStartDecision } from "./session-start-types";

const session = {
  externalSessionId: "saved",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/worktrees/task",
  startedAt: "2026-10-03T12:00:00.000Z",
  status: "idle" as const,
};
const selectedModel = {
  runtimeKind: "codex" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "medium",
};
const args = {
  workspaceId: "workspace",
  repoPath: "/repo",
  launchAttemptId: "attempt",
  request: {
    taskId: "task",
    role: "build" as const,
    launchActionId: "build_implementation_start" as const,
    postStartAction: "kickoff" as const,
  },
  decision: {
    startMode: "fresh" as const,
    selectedModel,
    kickoffPrompt: "\n  exact kickoff\n",
  },
};
const outcome = (request: WorkflowLaunchRequest): WorkflowLaunchSnapshot => ({
  launchAttemptId: request.launchAttemptId,
  workspaceId: request.workspaceId,
  repoPath: request.repoPath,
  taskId: request.taskId,
  role: "build",
  phase: "completed",
  acceptance: "accepted",
  ownershipSaved: true,
  completedPreStartActions: [],
  session,
});

test("submits the captured identity, model, edited text, and pre-start intent in one host command", async () => {
  const launch = mock(async (request: WorkflowLaunchRequest) => outcome(request));
  await startSessionWorkflow({
    ...args,
    decision: { ...args.decision, targetBranch: { branch: "main", remote: "origin" } },
    client: {
      agentSessionWorkflowLaunchRead: async () => [],
      agentSessionWorkflowLaunch: launch,
      agentSessionWorkflowLaunchRecover: async () => {
        throw new Error("unexpected recovery");
      },
    },
  });
  expect(launch.mock.calls[0]?.[0]).toEqual({
    launchAttemptId: "attempt",
    workspaceId: "workspace",
    repoPath: "/repo",
    taskId: "task",
    policy: {
      kind: "manual",
      actionId: "build_implementation_start",
      decision: { startMode: "fresh", selectedModel: selectedModel },
    },
    instruction: { kind: "kickoff", text: "\n  exact kickoff\n" },
    targetBranch: { branch: "main", remote: "origin" },
  });
});

test.each(["accepted", "unknown", "rejected", "not_submitted"] as const)(
  "offers host recovery only for known non-acceptance: %s",
  async (acceptance) => {
    const recovery = mock(async (_ref: import("@openducktor/contracts").WorkflowLaunchRef) =>
      outcome({
        launchAttemptId: args.launchAttemptId,
        workspaceId: args.workspaceId,
        repoPath: args.repoPath,
        taskId: "task",
        policy: {
          kind: "manual",
          actionId: args.request.launchActionId,
          decision: { startMode: "fresh", selectedModel: selectedModel },
        },
        instruction: { kind: "kickoff" },
      }),
    );
    const result = await startSessionWorkflow({
      ...args,
      client: {
        agentSessionWorkflowLaunchRead: async () => [],
        agentSessionWorkflowLaunch: async (request) => ({
          ...outcome(request),
          phase: "failed",
          acceptance,
          recoveryAllowed: acceptance === "rejected" || acceptance === "not_submitted",
          failure: { message: "Exact native failure", stage: "send", cleanupErrors: [] },
        }),
        agentSessionWorkflowLaunchRecover: recovery,
      },
    });
    expect(result.externalSessionId).toBe("saved");
    expect(result.postStartActionError?.message).toBe(
      "Exact native failure" +
        (acceptance === "unknown"
          ? " Runtime acceptance is unknown. Inspect the saved session before sending another instruction."
          : ""),
    );
    expect(result.postStartActionError).toBeInstanceOf(WorkflowLaunchFailure);
    if (result.postStartActionError instanceof WorkflowLaunchFailure) {
      expect(result.postStartActionError.outcome.acceptance).toBe(acceptance);
      expect(result.postStartActionError.outcome.failure?.message).toBe("Exact native failure");
      expect(result.postStartActionError.outcome.session?.externalSessionId).toBe("saved");
    }
    expect(Boolean(result.retryPostStartMessage)).toBe(
      acceptance === "rejected" || acceptance === "not_submitted",
    );
    if (result.retryPostStartMessage) {
      await result.retryPostStartMessage();
      expect(recovery.mock.calls[0]).toEqual([
        { workspaceId: "workspace", repoPath: "/repo", taskId: "task", launchAttemptId: "attempt" },
      ]);
    }
  },
);

test.each(["fresh", "reuse", "fork"] as const)(
  "submits the %s decision with its edited kickoff and launch options",
  async (startMode) => {
    const sourceSession = {
      externalSessionId: session.externalSessionId,
      runtimeKind: session.runtimeKind,
      workingDirectory: session.workingDirectory,
    };
    const targetBranch = { branch: "release", remote: "origin" };
    const beforeStartAction = { action: "human_request_changes" as const, note: "Fix the result" };
    const decision = (
      startMode === "reuse"
        ? { startMode, sourceSession, speed: null }
        : startMode === "fork"
          ? { startMode, sourceSession, selectedModel }
          : { startMode, selectedModel }
    ) satisfies ResolvedSessionStartDecision;
    const launch = mock(async (request: WorkflowLaunchRequest) => outcome(request));
    await startSessionWorkflow({
      ...args,
      decision: { ...decision, targetBranch, kickoffPrompt: "\n  edited text\n" },
      request: {
        ...args.request,
        message: "Review feedback",
        targetWorkingDirectory: "/repo/selected",
        queueIfBusy: true,
        beforeStartAction,
      },
      client: {
        agentSessionWorkflowLaunch: launch,
        agentSessionWorkflowLaunchRead: async () => [],
        agentSessionWorkflowLaunchRecover: async () => {
          throw new Error("Unexpected recovery");
        },
      },
    });
    const expected: WorkflowLaunchRequest = {
      workspaceId: args.workspaceId,
      repoPath: args.repoPath,
      taskId: args.request.taskId,
      launchAttemptId: args.launchAttemptId,
      policy: { kind: "manual", actionId: args.request.launchActionId, decision },
      instruction: { kind: "kickoff", text: "\n  edited text\n", feedback: "Review feedback" },
      targetBranch,
      targetWorkingDirectory: "/repo/selected",
      beforeStartAction,
    };
    if (startMode === "fresh") expected.queueIfBusy = true;
    expect(launch.mock.calls[0]?.[0]).toEqual(expected);
  },
);

test("a transport error does not launch again or resend", async () => {
  const launch = mock(async () => {
    throw new Error("Disconnected");
  });
  await expect(
    startSessionWorkflow({
      ...args,
      client: {
        agentSessionWorkflowLaunchRead: async () => [],
        agentSessionWorkflowLaunch: launch,
        agentSessionWorkflowLaunchRecover: async () => {
          throw new Error("unexpected recovery");
        },
      },
    }),
  ).rejects.toThrow("Disconnected");
  expect(launch).toHaveBeenCalledTimes(1);
});
