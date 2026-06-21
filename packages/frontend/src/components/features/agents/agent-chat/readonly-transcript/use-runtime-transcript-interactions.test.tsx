import { describe, expect, mock, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@/types/agent-orchestrator";
import { useRuntimeTranscriptInteractions } from "./use-runtime-transcript-interactions";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useRuntimeTranscriptInteractions>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useRuntimeTranscriptInteractions, initialProps);

const createApprovalRequest = (
  requestId: string,
  overrides: Partial<AgentApprovalRequest> = {},
): AgentApprovalRequest => ({
  requestId,
  requestType: "permission_grant",
  title: `Approve ${requestId}`,
  summary: `Approval request for ${requestId}.`,
  affectedPaths: ["*"],
  action: { name: requestId },
  mutation: "mutating",
  supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
  ...overrides,
});

const createQuestionRequest = (requestId: string): AgentQuestionRequest => ({
  requestId,
  questions: [
    {
      header: "Choose path",
      question: "Which path should the subagent use?",
      options: [{ label: "A", description: "Path A" }],
    },
  ],
});

const createTarget = (overrides: Partial<AgentSessionIdentity> = {}): AgentSessionIdentity => ({
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo-a",
  ...overrides,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  target: createTarget(),
  pendingApprovalRequests: [],
  pendingQuestionRequests: [],
  isRuntimeReady: true,
  replyAgentApproval: async () => {},
  answerAgentQuestion: async () => {},
  ...overrides,
});

describe("useRuntimeTranscriptInteractions", () => {
  test("uses provided pending requests for the transcript target", async () => {
    const sessionApproval = createApprovalRequest("session-approval");
    const sessionQuestion = createQuestionRequest("session-question");
    const harness = createHookHarness(
      createBaseArgs({
        pendingApprovalRequests: [sessionApproval],
        pendingQuestionRequests: [sessionQuestion],
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().pendingApprovalRequests).toEqual([sessionApproval]);
      expect(harness.getLatest().pendingQuestionRequests).toEqual([sessionQuestion]);
      expect(harness.getLatest().approvals.canReply).toBe(true);
      expect(harness.getLatest().pendingQuestions.canSubmit).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("routes approval replies to the transcript session", async () => {
    const replyAgentApproval = mock(async () => {});
    const pendingApproval = createApprovalRequest("approval-1");
    const harness = createHookHarness(
      createBaseArgs({
        pendingApprovalRequests: [pendingApproval],
        replyAgentApproval,
      }),
    );

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.approvals.onReply("approval-1", "approve_once");
      });

      expect(replyAgentApproval).toHaveBeenCalledWith(
        createTarget(),
        pendingApproval,
        "approve_once",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("blocks approval replies when the transcript target is missing", async () => {
    const replyAgentApproval = mock(async () => {});
    const pendingApproval = createApprovalRequest("approval-1");
    const harness = createHookHarness(
      createBaseArgs({
        target: null,
        pendingApprovalRequests: [pendingApproval],
        replyAgentApproval,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().approvals.canReply).toBe(false);
      await harness.run(async (state) => {
        await state.approvals.onReply("approval-1", "approve_once");
      });
      expect(replyAgentApproval).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("tracks question submission until the runtime answer resolves", async () => {
    const deferredAnswer = createDeferred<void>();
    const answerAgentQuestion = mock(async () => deferredAnswer.promise);
    const pendingQuestion = createQuestionRequest("question-1");
    const harness = createHookHarness(
      createBaseArgs({
        pendingQuestionRequests: [pendingQuestion],
        answerAgentQuestion,
      }),
    );

    try {
      await harness.mount();
      await harness.run((state) => {
        void state.pendingQuestions.onSubmit("question-1", [["A"]]);
      });
      await harness.waitFor(
        (state) => state.pendingQuestions.isSubmittingByRequestId["question-1"] === true,
      );

      expect(answerAgentQuestion).toHaveBeenCalledWith(createTarget(), pendingQuestion, [["A"]]);

      await harness.run(async () => {
        deferredAnswer.resolve(undefined);
        await deferredAnswer.promise;
      });
      await harness.waitFor(
        (state) => state.pendingQuestions.isSubmittingByRequestId["question-1"] === undefined,
      );
      expect(harness.getLatest().pendingQuestionRequests).toEqual([pendingQuestion]);
      expect(harness.getLatest().pendingQuestions.isSubmittingByRequestId["question-1"]).toBe(
        undefined,
      );
    } finally {
      deferredAnswer.resolve(undefined);
      await harness.unmount();
    }
  });

  test("resets question submission state when the transcript session changes", async () => {
    const deferredAnswer = createDeferred<void>();
    const answerAgentQuestion = mock(async () => deferredAnswer.promise);
    const pendingQuestion = createQuestionRequest("question-1");
    const baseArgs = createBaseArgs({
      pendingQuestionRequests: [pendingQuestion],
      answerAgentQuestion,
    });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.run((state) => {
        void state.pendingQuestions.onSubmit("question-1", [["A"]]);
      });
      await harness.waitFor(
        (state) => state.pendingQuestions.isSubmittingByRequestId["question-1"] === true,
      );

      await harness.update({
        ...baseArgs,
        target: createTarget({ externalSessionId: "session-2" }),
        pendingQuestionRequests: [],
      });

      expect(harness.getLatest().pendingQuestions.isSubmittingByRequestId).toEqual({});
    } finally {
      deferredAnswer.resolve(undefined);
      await harness.unmount();
    }
  });

  test("resets question submission state when the same session id points to another runtime session", async () => {
    const deferredAnswer = createDeferred<void>();
    const answerAgentQuestion = mock(async () => deferredAnswer.promise);
    const pendingQuestion = createQuestionRequest("question-1");
    const baseArgs = createBaseArgs({
      pendingQuestionRequests: [pendingQuestion],
      answerAgentQuestion,
    });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.run((state) => {
        void state.pendingQuestions.onSubmit("question-1", [["A"]]);
      });
      await harness.waitFor(
        (state) => state.pendingQuestions.isSubmittingByRequestId["question-1"] === true,
      );

      await harness.update({
        ...baseArgs,
        target: createTarget({ workingDirectory: "/repo-b" }),
        pendingQuestionRequests: [],
      });

      expect(harness.getLatest().pendingQuestions.isSubmittingByRequestId).toEqual({});
    } finally {
      deferredAnswer.resolve(undefined);
      await harness.unmount();
    }
  });

  test("keeps actions disabled while the runtime is not ready", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        pendingApprovalRequests: [createApprovalRequest("approval-1")],
        pendingQuestionRequests: [createQuestionRequest("question-1")],
        isRuntimeReady: false,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().approvals.canReply).toBe(false);
      expect(harness.getLatest().pendingQuestions.canSubmit).toBe(false);
    } finally {
      await harness.unmount();
    }
  });
});
