import type { AgentAsyncQuestion } from "@openducktor/contracts";
import { describe, expect, mock, test } from "bun:test";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { useAgentAsyncQuestionActions } from "./use-agent-async-question-actions";

enableReactActEnvironment();

const sessionIdentity: AgentSessionIdentity = {
  externalSessionId: "child-session",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
};

const question: AgentAsyncQuestion = {
  questionItemId: '["request_user_input_async","question-1",0]',
  sourceMessageId: "question-1",
  questionIndex: 0,
  title: "Which environment?",
  options: ["Staging", "Production"],
};

describe("useAgentAsyncQuestionActions", () => {
  test("sends a child reply with its inherited workflow scope", async () => {
    const sendAgentMessage = mock(async () => {});
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
    const harness = createHookHarness(useAgentAsyncQuestionActions, {
      sessionIdentity,
      sessionScope,
      canSubmit: true,
      sendAgentMessage,
    });

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.onSubmit(question, "Staging");
      });

      expect(sendAgentMessage).toHaveBeenCalledWith(
        sessionIdentity,
        [
          {
            kind: "async_question_reply",
            questionItemId: question.questionItemId,
            question: question.title,
            answer: "Staging",
          },
        ],
        { sessionScope },
      );
    } finally {
      await harness.unmount();
    }
  });
});
