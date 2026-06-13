import { describe, expect, mock, test } from "bun:test";
import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createAgentSessionFixture, createDeferred } from "@/test-utils/shared-test-fixtures";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { getRuntimeTranscriptIdentityKey } from "./runtime-transcript-identity";
import {
  mergeRuntimePendingApprovals,
  mergeRuntimePendingQuestions,
  mergeRuntimePendingRequests,
} from "./runtime-transcript-pending-requests";
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

const createSource = (
  overrides: Partial<RuntimeSessionTranscriptSource> = {},
): RuntimeSessionTranscriptSource => ({
  runtimeKind: "opencode",
  workingDirectory: "/repo-a",
  ...overrides,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  session: createAgentSessionFixture({
    externalSessionId: "session-1",
    repoPath: "/repo-a",
    pendingApprovals: [],
    pendingQuestions: [],
  }),
  source: createSource(),
  externalSessionId: "session-1",
  isRuntimeReady: true,
  replyAgentApproval: async () => {},
  answerAgentQuestion: async () => {},
  ...overrides,
});

describe("runtime transcript pending request helpers", () => {
  test("requires an external session id for transcript interaction identity", () => {
    expect(
      getRuntimeTranscriptIdentityKey({
        externalSessionId: null,
        source: createSource(),
      }),
    ).toBeNull();
    expect(
      getRuntimeTranscriptIdentityKey({
        externalSessionId: "session-1",
        source: createSource(),
      }),
    ).toBe("session-1\u0000opencode\u0000/repo-a");
  });

  test("merges source and session requests by request id and hides replied requests", () => {
    const sourceShared = createApprovalRequest("shared", { title: "source shared" });
    const sessionShared = createApprovalRequest("shared", { title: "session shared" });

    expect(
      mergeRuntimePendingRequests(
        [createApprovalRequest("source-only"), sourceShared],
        [sessionShared, createApprovalRequest("session-only")],
        new Set(["source-only"]),
      ),
    ).toEqual([sessionShared, createApprovalRequest("session-only")]);
  });

  test("merges typed approval and question requests from transcript sources", () => {
    const sourceApproval = createApprovalRequest("source-approval");
    const sessionApproval = createApprovalRequest("session-approval");
    const sourceQuestion = createQuestionRequest("source-question");
    const sessionQuestion = createQuestionRequest("session-question");
    const source = createSource({
      pendingApprovals: [sourceApproval],
      pendingQuestions: [sourceQuestion],
    });
    const session = createAgentSessionFixture({
      externalSessionId: "session-1",
      repoPath: "/repo-a",
      pendingApprovals: [sessionApproval],
      pendingQuestions: [sessionQuestion],
    });

    expect(
      mergeRuntimePendingApprovals({
        source,
        session,
        repliedRequestIds: new Set(["source-approval"]),
      }),
    ).toEqual([sessionApproval]);
    expect(
      mergeRuntimePendingQuestions({
        source,
        session,
        repliedRequestIds: new Set(["session-question"]),
      }),
    ).toEqual([sourceQuestion]);
  });
});

describe("useRuntimeTranscriptInteractions", () => {
  test("merges parent-observed and live-session pending requests onto the transcript session", async () => {
    const sourceApproval = createApprovalRequest("source-approval");
    const sessionApproval = createApprovalRequest("session-approval");
    const sourceQuestion = createQuestionRequest("source-question");
    const sessionQuestion = createQuestionRequest("session-question");
    const harness = createHookHarness(
      createBaseArgs({
        source: createSource({
          pendingApprovals: [sourceApproval],
          pendingQuestions: [sourceQuestion],
        }),
        session: createAgentSessionFixture({
          externalSessionId: "session-1",
          repoPath: "/repo-a",
          pendingApprovals: [sessionApproval],
          pendingQuestions: [sessionQuestion],
        }),
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().session?.pendingApprovals).toEqual([
        sourceApproval,
        sessionApproval,
      ]);
      expect(harness.getLatest().session?.pendingQuestions).toEqual([
        sourceQuestion,
        sessionQuestion,
      ]);
      expect(harness.getLatest().approvals.canReply).toBe(true);
      expect(harness.getLatest().pendingQuestions.canSubmit).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("routes approval replies to the transcript session and hides replied approvals", async () => {
    const replyAgentApproval = mock(
      async (
        _externalSessionId: string,
        _requestId: string,
        _outcome: RuntimeApprovalReplyOutcome,
      ) => {},
    );
    const pendingApproval = createApprovalRequest("approval-1");
    const harness = createHookHarness(
      createBaseArgs({
        source: createSource({ pendingApprovals: [pendingApproval] }),
        replyAgentApproval,
      }),
    );

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.approvals.onReply("approval-1", "approve_once");
      });

      expect(replyAgentApproval).toHaveBeenCalledWith("session-1", "approval-1", "approve_once");
      await harness.waitFor((state) => state.session?.pendingApprovals.length === 0);
    } finally {
      await harness.unmount();
    }
  });

  test("blocks approval replies when the active session id does not match the transcript target", async () => {
    const replyAgentApproval = mock(
      async (
        _externalSessionId: string,
        _requestId: string,
        _outcome: RuntimeApprovalReplyOutcome,
      ) => {},
    );
    const pendingApproval = createApprovalRequest("approval-1");
    const harness = createHookHarness(
      createBaseArgs({
        externalSessionId: "session-requested",
        source: createSource({ pendingApprovals: [pendingApproval] }),
        session: createAgentSessionFixture({
          externalSessionId: "session-other",
          repoPath: "/repo-a",
          pendingApprovals: [],
          pendingQuestions: [],
        }),
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

  test("tracks question submission and hides answered questions", async () => {
    const deferredAnswer = createDeferred<void>();
    const answerAgentQuestion = mock(async () => deferredAnswer.promise);
    const pendingQuestion = createQuestionRequest("question-1");
    const harness = createHookHarness(
      createBaseArgs({
        source: createSource({ pendingQuestions: [pendingQuestion] }),
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

      expect(answerAgentQuestion).toHaveBeenCalledWith("session-1", "question-1", [["A"]]);

      await harness.run(async () => {
        deferredAnswer.resolve(undefined);
        await deferredAnswer.promise;
      });
      await harness.waitFor((state) => state.session?.pendingQuestions.length === 0);
      expect(harness.getLatest().pendingQuestions.isSubmittingByRequestId["question-1"]).toBe(
        undefined,
      );
    } finally {
      deferredAnswer.resolve(undefined);
      await harness.unmount();
    }
  });

  test("resets replied request state when the transcript identity changes", async () => {
    const replyAgentApproval = mock(async () => {});
    const pendingApproval = createApprovalRequest("approval-1");
    const baseArgs = createBaseArgs({
      source: createSource({ pendingApprovals: [pendingApproval] }),
      replyAgentApproval,
    });
    const harness = createHookHarness(baseArgs);

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.approvals.onReply("approval-1", "approve_once");
      });
      await harness.waitFor((state) => state.session?.pendingApprovals.length === 0);

      await harness.update({
        ...baseArgs,
        externalSessionId: "session-2",
        session: createAgentSessionFixture({
          externalSessionId: "session-2",
          repoPath: "/repo-a",
          pendingApprovals: [],
          pendingQuestions: [],
        }),
      });
      await harness.waitFor((state) => state.session?.pendingApprovals.length === 1);

      expect(harness.getLatest().session?.pendingApprovals).toEqual([pendingApproval]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps actions disabled while the runtime is not ready", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        source: createSource({
          pendingApprovals: [createApprovalRequest("approval-1")],
          pendingQuestions: [createQuestionRequest("question-1")],
        }),
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
