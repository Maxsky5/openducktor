import { expect, mock, test } from "bun:test";
import {
  type WorkflowLaunchRequest,
  type WorkflowLaunchResult,
  workflowLaunchRequestSchema,
} from "@openducktor/contracts";
import type { AgentUserMessagePart } from "@openducktor/core";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type {
  AgentMessageSendOptions,
  AgentMessageSendReceipt,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { startSessionWorkflow, WorkflowLaunchFailure } from "./session-start-workflow";
import type { ResolvedSessionStartDecision, SessionStartFlowRequest } from "./session-start-types";

const session = {
  externalSessionId: "saved",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/worktrees/task",
  startedAt: "2026-10-03T12:00:00.000Z",
  status: "idle" as const,
};
const sourceSession = {
  externalSessionId: "source",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/conflict",
};
const selectedModel = {
  runtimeKind: "codex" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "medium",
};
const baseRequest: SessionStartFlowRequest = {
  taskId: "task",
  role: "build",
  launchActionId: "build_implementation_start",
  postStartAction: "kickoff",
};
const freshDecision: ResolvedSessionStartDecision = {
  startMode: "fresh",
  selectedModel,
  kickoffPrompt: "\n  exact kickoff\n",
};
const acceptedMessage = {
  type: "user_message" as const,
  externalSessionId: "saved",
  messageId: "message-1",
  message: "Kickoff",
  parts: [],
  timestamp: "2026-10-03T12:00:00.000Z",
  state: "read" as const,
};
const result = (
  request: WorkflowLaunchRequest,
  overrides: Partial<WorkflowLaunchResult> = {},
): WorkflowLaunchResult => ({
  workspaceId: request.workspaceId,
  repoPath: request.repoPath,
  taskId: request.taskId,
  role: "build",
  status: "completed",
  startMode: "fresh",
  session: { ...session },
  ...overrides,
});
const createLaunch = (overrides: Partial<WorkflowLaunchResult> = {}) =>
  mock(async (request: WorkflowLaunchRequest) => result(request, overrides));
const start = (
  launch: ReturnType<typeof createLaunch>,
  input: {
    request?: SessionStartFlowRequest;
    decision?: ResolvedSessionStartDecision;
    sendAgentMessage?: (
      session: AgentSessionIdentity,
      parts: AgentUserMessagePart[],
      options?: AgentMessageSendOptions,
    ) => Promise<AgentMessageSendReceipt | null>;
  } = {},
) => {
  return startSessionWorkflow({
    workspaceId: "workspace",
    repoPath: "/repo",
    request: input.request ?? baseRequest,
    decision: input.decision ?? freshDecision,
    client: { agentSessionWorkflowLaunch: launch },
    sendAgentMessage: input.sendAgentMessage ?? (async () => null),
  });
};
const sentRequest = (launch: ReturnType<typeof createLaunch>): WorkflowLaunchRequest => {
  const request = launch.mock.calls[0]?.[0];
  if (!request) throw new Error("Expected one host launch");
  return request;
};

test("submits the captured identity, model, edited text, and target branch in one host command", async () => {
  const launch = createLaunch();
  const started = await start(launch, {
    decision: { ...freshDecision, targetBranch: { branch: "main", remote: "origin" } },
  });
  expect(launch).toHaveBeenCalledTimes(1);
  expect(sentRequest(launch)).toEqual({
    workspaceId: "workspace",
    repoPath: "/repo",
    taskId: "task",
    policy: {
      kind: "manual",
      actionId: "build_implementation_start",
      decision: { startMode: "fresh", selectedModel },
    },
    instruction: { kind: "kickoff", text: "\n  exact kickoff\n" },
    targetBranch: { branch: "main", remote: "origin" },
  });
  expect(started).toEqual({
    externalSessionId: "saved",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktrees/task",
    postStartActionError: null,
  });
});

test("sends the review feedback and the pre-start action with the kickoff", async () => {
  const launch = createLaunch();
  const beforeStartAction = { action: "human_request_changes" as const, note: "Fix the result" };
  await start(launch, {
    request: {
      ...baseRequest,
      launchActionId: "build_after_human_request_changes",
      message: "Review feedback",
      beforeStartAction,
    },
  });
  expect(sentRequest(launch)).toMatchObject({
    policy: { actionId: "build_after_human_request_changes" },
    instruction: { kind: "kickoff", text: "\n  exact kickoff\n", feedback: "Review feedback" },
    beforeStartAction,
  });
});

test("sends the composer parts as the first message", async () => {
  const launch = createLaunch();
  await start(launch, {
    request: {
      ...baseRequest,
      postStartAction: "send_message",
      message: "ignored",
      parts: [{ kind: "text", text: "  Keep whitespace  " }],
    },
  });
  expect(sentRequest(launch).instruction).toEqual({
    kind: "message",
    parts: [{ kind: "text", text: "  Keep whitespace  " }],
  });
});

test("sends no instruction when the start has no post-start action", async () => {
  const launch = createLaunch();
  await start(launch, { request: { ...baseRequest, postStartAction: "none" } });
  expect(sentRequest(launch).instruction).toEqual({ kind: "none" });
});

test("a git conflict reuse start sends no target working directory", async () => {
  const launch = createLaunch({ startMode: "reuse" });
  await start(launch, {
    request: {
      ...baseRequest,
      launchActionId: "build_rebase_conflict_resolution",
      postStartAction: "send_message",
      message: "Resolve the conflict",
      targetWorkingDirectory: "/repo/conflict",
    },
    decision: { startMode: "reuse", sourceSession },
  });
  const request = sentRequest(launch);
  expect(request.policy).toEqual({
    kind: "manual",
    actionId: "build_rebase_conflict_resolution",
    decision: { startMode: "reuse", sourceSession },
  });
  expect(() => workflowLaunchRequestSchema.parse(request)).not.toThrow();
});

test.each(["fast", null] as const)("a reuse start sends the selected speed %p", async (speed) => {
  const launch = createLaunch({ startMode: "reuse" });
  await start(launch, { decision: { startMode: "reuse", sourceSession, speed } });
  expect(sentRequest(launch).policy).toEqual({
    kind: "manual",
    actionId: "build_implementation_start",
    decision: { startMode: "reuse", sourceSession, speed },
  });
});

test("a git conflict fork start sends no target working directory", async () => {
  const launch = createLaunch({ startMode: "fork" });
  await start(launch, {
    request: { ...baseRequest, targetWorkingDirectory: "/repo/conflict" },
    decision: { startMode: "fork", sourceSession, selectedModel },
  });
  const request = sentRequest(launch);
  expect(request.policy).toMatchObject({
    decision: { startMode: "fork", sourceSession, selectedModel },
  });
  expect(request.policy).not.toHaveProperty("decision.targetWorkingDirectory");
  expect(() => workflowLaunchRequestSchema.parse(request)).not.toThrow();
});

test("a git conflict fresh start sends the target working directory on the fresh decision", async () => {
  const launch = createLaunch();
  await start(launch, {
    request: {
      ...baseRequest,
      launchActionId: "build_rebase_conflict_resolution",
      postStartAction: "send_message",
      message: "Resolve the conflict",
      targetWorkingDirectory: "/repo/conflict",
    },
    decision: { startMode: "fresh", selectedModel },
  });
  const request = sentRequest(launch);
  expect(request.policy).toEqual({
    kind: "manual",
    actionId: "build_rebase_conflict_resolution",
    decision: { startMode: "fresh", selectedModel, targetWorkingDirectory: "/repo/conflict" },
  });
  expect(request).not.toHaveProperty("targetWorkingDirectory");
  expect(() => workflowLaunchRequestSchema.parse(request)).not.toThrow();
});

test("a reuse start checks only the launch context before it calls the host", async () => {
  const launch = createLaunch({ startMode: "reuse" });
  const assertBeforeLaunch = mock(() => {});
  const assertCanSubmit = mock(() => {
    throw new Error("Wait for the session transcript to load.");
  });
  const started = await start(launch, {
    request: {
      ...baseRequest,
      postStartAction: "send_message",
      message: "Continue",
      assertBeforeLaunch,
      assertCanSubmit,
    },
    decision: { startMode: "reuse", sourceSession },
  });
  expect(assertBeforeLaunch).toHaveBeenCalledTimes(1);
  expect(assertCanSubmit).not.toHaveBeenCalled();
  expect(launch).toHaveBeenCalledTimes(1);
  expect(started.postStartActionError).toBeNull();
});

test("a stale launch context stops the start before the host call", async () => {
  const launch = createLaunch();
  let thrown: unknown;
  try {
    await start(launch, {
      request: {
        ...baseRequest,
        assertBeforeLaunch: () => {
          throw new Error("The task changed.");
        },
      },
    });
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toHaveProperty("message", "The task changed.");
  expect(launch).not.toHaveBeenCalled();
});

test("a fresh start without a runtime throws before the host call", async () => {
  const launch = createLaunch();
  let thrown: unknown;
  try {
    await start(launch, {
      decision: { startMode: "fresh", selectedModel: { ...selectedModel, runtimeKind: undefined } },
    });
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toHaveProperty("message", "Session start requires a selected runtime and model.");
  expect(launch).not.toHaveBeenCalled();
});

test("a result without a saved session throws the host failure and its cleanup errors", async () => {
  const launch = createLaunch({
    status: "failed",
    session: undefined,
    failure: { message: "Runtime is offline", cleanupErrors: ["Cannot remove worktree"] },
  });
  let thrown: unknown;
  try {
    await start(launch);
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toBeInstanceOf(WorkflowLaunchFailure);
  expect(thrown).toHaveProperty(
    "message",
    "Runtime is offline Cleanup failed: Cannot remove worktree",
  );
  expect(thrown).toHaveProperty("outcome.status", "failed");
});

test.each([
  ["skipped", { skipReason: "No Builder source" }, "No Builder source"],
  ["canceled", {}, "Workflow launch was canceled."],
] as const)("a %s result without a session throws its reason", async (status, extra, message) => {
  const launch = createLaunch({ status, session: undefined, ...extra });
  let thrown: unknown;
  try {
    await start(launch);
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toBeInstanceOf(WorkflowLaunchFailure);
  expect(thrown).toHaveProperty("message", message);
});

test("a failed result with a saved session returns the failure as a post-start error", async () => {
  const launch = createLaunch({
    status: "failed",
    failure: { message: "Kickoff failed", cleanupErrors: [] },
  });
  const started = await start(launch);
  expect(started.externalSessionId).toBe("saved");
  expect(started.postStartActionError).toBeInstanceOf(WorkflowLaunchFailure);
  expect(started.postStartActionError?.message).toBe("Kickoff failed");
  expect(started.retryPostStartMessage).toBeUndefined();
});

test("an accepted first message gives a receipt and no retry", async () => {
  const sendAgentMessage = mock(async () => null);
  const launch = createLaunch({
    status: "failed",
    acceptedMessage,
    failure: { message: "Stream closed after acceptance", cleanupErrors: [] },
  });
  const started = await start(launch, { sendAgentMessage });
  expect(started.postStartMessageReceipt).toEqual({
    recipient: {
      externalSessionId: "saved",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktrees/task",
    },
    acceptedMessage,
    postAcceptanceFailure: "Stream closed after acceptance",
  });
  expect(started.retryPostStartMessage).toBeUndefined();
  expect(sendAgentMessage).not.toHaveBeenCalled();
});

test("a completed accepted first message gives a receipt without a failure", async () => {
  const started = await start(createLaunch({ acceptedMessage }));
  expect(started.postStartActionError).toBeNull();
  expect(started.postStartMessageReceipt?.postAcceptanceFailure).toBeNull();
});

test("retry sends the unsent kickoff once through the frontend send path", async () => {
  const unsentInstruction = [{ kind: "text" as const, text: "\n  exact kickoff\n" }];
  const launch = createLaunch({
    status: "failed",
    unsentInstruction,
    failure: { message: "Runtime rejected the kickoff", cleanupErrors: [] },
  });
  const assertBeforeLaunch = mock(() => {});
  const assertCanSubmit = mock((_session: AgentSessionState) => {});
  let receipt: AgentMessageSendReceipt | null = null;
  const sendAgentMessage = mock(
    async (
      recipient: AgentSessionIdentity,
      _parts: AgentUserMessagePart[],
      options?: AgentMessageSendOptions,
    ) => {
      options?.assertCanSubmit?.(
        createAgentSessionFixture({
          externalSessionId: recipient.externalSessionId,
          runtimeKind: recipient.runtimeKind,
          workingDirectory: recipient.workingDirectory,
        }),
      );
      receipt = { recipient, acceptedMessage, postAcceptanceFailure: null };
      return receipt;
    },
  );
  const started = await start(launch, {
    request: { ...baseRequest, assertBeforeLaunch, assertCanSubmit },
    sendAgentMessage,
  });
  expect(started.postStartActionError?.message).toBe("Runtime rejected the kickoff");
  expect(assertBeforeLaunch).toHaveBeenCalledTimes(1);
  expect(assertCanSubmit).not.toHaveBeenCalled();
  expect(sendAgentMessage).not.toHaveBeenCalled();
  if (!started.retryPostStartMessage) throw new Error("Expected a retry");

  await started.retryPostStartMessage();
  await started.retryPostStartMessage();

  expect(sendAgentMessage).toHaveBeenCalledTimes(1);
  const [recipient, parts, options] = sendAgentMessage.mock.calls[0] ?? [];
  expect(recipient).toMatchObject({
    externalSessionId: "saved",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktrees/task",
  });
  expect(parts).toEqual(unsentInstruction);
  expect(options?.preserveTextWhitespace).toBe(true);
  expect(assertBeforeLaunch).toHaveBeenCalledTimes(2);
  expect(assertCanSubmit).toHaveBeenCalledTimes(1);
  expect(assertCanSubmit.mock.calls[0]?.[0]).toMatchObject({ externalSessionId: "saved" });
});

test("retry keeps a composer message as typed and can run again after a failed send", async () => {
  const unsentInstruction = [{ kind: "text" as const, text: "Continue" }];
  const launch = createLaunch({
    status: "failed",
    unsentInstruction,
    failure: { message: "Runtime rejected the message", cleanupErrors: [] },
  });
  let attempts = 0;
  const sendAgentMessage = mock(
    async (
      recipient: AgentSessionIdentity,
      _parts: AgentUserMessagePart[],
      options?: AgentMessageSendOptions,
    ) => {
      attempts += 1;
      if (attempts === 1) throw new Error("Still offline");
      expect(options).toEqual({});
      return { recipient, acceptedMessage, postAcceptanceFailure: null };
    },
  );
  const started = await start(launch, {
    request: { ...baseRequest, postStartAction: "send_message", message: "Continue" },
    sendAgentMessage,
  });
  if (!started.retryPostStartMessage) throw new Error("Expected a retry");
  let retryError: unknown;
  try {
    await started.retryPostStartMessage();
  } catch (cause) {
    retryError = cause;
  }
  expect(retryError).toHaveProperty("message", "Still offline");
  await started.retryPostStartMessage();
  await started.retryPostStartMessage();
  expect(sendAgentMessage).toHaveBeenCalledTimes(2);
});

test("a stale context stops the retry before it sends", async () => {
  let current = true;
  const sendAgentMessage = mock(
    async (
      recipient: AgentSessionIdentity,
      _parts: AgentUserMessagePart[],
      options?: AgentMessageSendOptions,
    ) => {
      options?.assertCanSubmit?.(
        createAgentSessionFixture({
          externalSessionId: recipient.externalSessionId,
          runtimeKind: recipient.runtimeKind,
          workingDirectory: recipient.workingDirectory,
        }),
      );
      return null;
    },
  );
  const started = await start(
    createLaunch({
      status: "failed",
      unsentInstruction: [{ kind: "text", text: "Kickoff" }],
      failure: { message: "Rejected", cleanupErrors: [] },
    }),
    {
      request: {
        ...baseRequest,
        assertBeforeLaunch: () => {
          if (!current) throw new Error("The task changed.");
        },
      },
      sendAgentMessage,
    },
  );
  current = false;
  let thrown: unknown;
  try {
    await started.retryPostStartMessage?.();
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toHaveProperty("message", "The task changed.");
});

test("a transport error does not launch again or resend", async () => {
  const launch = mock(async (_request: WorkflowLaunchRequest): Promise<WorkflowLaunchResult> => {
    throw new Error("Disconnected");
  });
  const sendAgentMessage = mock(async () => null);
  let thrown: unknown;
  try {
    await startSessionWorkflow({
      workspaceId: "workspace",
      repoPath: "/repo",
      request: baseRequest,
      decision: freshDecision,
      client: { agentSessionWorkflowLaunch: launch },
      sendAgentMessage,
    });
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toHaveProperty("message", "Disconnected");
  expect(launch).toHaveBeenCalledTimes(1);
  expect(sendAgentMessage).not.toHaveBeenCalled();
});
