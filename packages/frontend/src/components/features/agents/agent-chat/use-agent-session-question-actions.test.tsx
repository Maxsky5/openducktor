import { describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred, TEST_EXTERNAL_SESSION_IDS } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { useAgentSessionQuestionActions } from "./use-agent-session-question-actions";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useAgentSessionQuestionActions>[0];

const sessionIdentity = (
  externalSessionId: string = TEST_EXTERNAL_SESSION_IDS.default,
  runtimeKind: AgentSessionIdentity["runtimeKind"] = "opencode",
): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind,
  workingDirectory: `/repo/${runtimeKind}/${externalSessionId}`,
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  sessionIdentity: sessionIdentity(),
  pendingQuestionRequestIds: ["req-1"],
  canAnswerQuestions: true,
  answerAgentQuestion: async () => {},
  ...overrides,
});

describe("useAgentSessionQuestionActions", () => {
  test("does nothing when there is no session or questions cannot be answered", async () => {
    const answerAgentQuestion = mock(async () => {});
    const harness = createHookHarness(
      useAgentSessionQuestionActions,
      createBaseArgs({ sessionIdentity: null, answerAgentQuestion }),
    );

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onSubmitQuestionAnswers("req-1", [["yes"]]);
      });

      await harness.update(createBaseArgs({ canAnswerQuestions: false, answerAgentQuestion }));
      await harness.run(async (state) => {
        await state.onSubmitQuestionAnswers("req-1", [["yes"]]);
      });

      expect(answerAgentQuestion).not.toHaveBeenCalled();
      expect(harness.getLatest().isSubmittingQuestionByRequestId).toEqual({});
    } finally {
      await harness.unmount();
    }
  });

  test("tracks submitting state while sending a question answer", async () => {
    const answerDeferred = createDeferred<void>();
    const answerAgentQuestion = mock(async () => answerDeferred.promise);
    const harness = createHookHarness(
      useAgentSessionQuestionActions,
      createBaseArgs({ answerAgentQuestion }),
    );

    try {
      await harness.mount();
      let submitPromise: Promise<void> | null = null;

      await harness.run((state) => {
        submitPromise = state.onSubmitQuestionAnswers("req-1", [["yes"]]);
      });

      await harness.waitFor((state) => state.isSubmittingQuestionByRequestId["req-1"] === true);
      expect(answerAgentQuestion).toHaveBeenCalledWith(sessionIdentity(), "req-1", [["yes"]]);

      await harness.run(async () => {
        answerDeferred.resolve(undefined);
        await submitPromise;
      });

      await harness.waitFor((state) => state.isSubmittingQuestionByRequestId["req-1"] !== true);
    } finally {
      answerDeferred.resolve(undefined);
      await harness.unmount();
    }
  });

  test("keeps submitting state scoped by full session identity", async () => {
    const answerDeferred = createDeferred<void>();
    const answerAgentQuestion = mock(async () => answerDeferred.promise);
    const firstSessionIdentity = sessionIdentity("shared-session", "opencode");
    const secondSessionIdentity = sessionIdentity("shared-session", "codex");
    const harness = createHookHarness(
      useAgentSessionQuestionActions,
      createBaseArgs({ sessionIdentity: firstSessionIdentity, answerAgentQuestion }),
    );

    try {
      await harness.mount();
      let submitPromise: Promise<void> | null = null;
      await harness.run((state) => {
        submitPromise = state.onSubmitQuestionAnswers("req-1", [["yes"]]);
      });
      await harness.waitFor((state) => state.isSubmittingQuestionByRequestId["req-1"] === true);

      await harness.update(
        createBaseArgs({ sessionIdentity: secondSessionIdentity, answerAgentQuestion }),
      );

      expect(harness.getLatest().isSubmittingQuestionByRequestId).toEqual({});

      await harness.run(async () => {
        answerDeferred.resolve(undefined);
        await submitPromise;
      });
    } finally {
      answerDeferred.resolve(undefined);
      await harness.unmount();
    }
  });

  test("hides submitting state for questions no longer pending", async () => {
    const answerDeferred = createDeferred<void>();
    const answerAgentQuestion = mock(async () => answerDeferred.promise);
    const harness = createHookHarness(
      useAgentSessionQuestionActions,
      createBaseArgs({ answerAgentQuestion }),
    );

    try {
      await harness.mount();
      let submitPromise: Promise<void> | null = null;
      await harness.run((state) => {
        submitPromise = state.onSubmitQuestionAnswers("req-1", [["yes"]]);
      });
      await harness.waitFor((state) => state.isSubmittingQuestionByRequestId["req-1"] === true);

      await harness.update(
        createBaseArgs({ pendingQuestionRequestIds: ["req-2"], answerAgentQuestion }),
      );

      expect(harness.getLatest().isSubmittingQuestionByRequestId).toEqual({});

      await harness.run(async () => {
        answerDeferred.resolve(undefined);
        await submitPromise;
      });
    } finally {
      answerDeferred.resolve(undefined);
      await harness.unmount();
    }
  });
});
