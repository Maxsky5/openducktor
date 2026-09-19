import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import {
  clearAgentAsyncQuestionDrafts,
  pruneAgentAsyncQuestionDrafts,
} from "@/state/agent-async-question-draft-store";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentAsyncQuestionCard } from "./agent-async-question-card";

describe("AgentAsyncQuestionCard", () => {
  const sessionIdentity = {
    externalSessionId: "session-1",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo",
  };

  beforeEach(() => {
    clearAgentAsyncQuestionDrafts(sessionIdentity);
  });

  test("offers suggestions and accepts free text", async () => {
    const onSubmit = mock(async () => {});
    const question = {
      questionItemId: '["request_user_input_async","message-1",0]',
      sourceMessageId: "message-1",
      questionIndex: 0,
      title: "Which environment should I use?",
      options: ["Staging", "Production"],
    };
    const view = render(
      <AgentAsyncQuestionCard
        sessionIdentity={sessionIdentity}
        question={question}
        disabled={false}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Staging" }));
    const input = view.getByLabelText(`Answer: ${question.title}`);
    if (!(input instanceof HTMLInputElement)) throw new Error("Expected an answer input.");
    expect(input.value).toBe("Staging");
    fireEvent.change(view.getByLabelText(`Answer: ${question.title}`), {
      target: { value: "Use the canary environment" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(question, "Use the canary environment");
    });
  });

  test("restores drafts by full session identity", () => {
    const question = {
      questionItemId: '["request_user_input_async","message-shared",0]',
      sourceMessageId: "message-shared",
      questionIndex: 0,
      title: "Which environment should I use?",
      options: null,
    };
    const first = render(
      <AgentAsyncQuestionCard
        sessionIdentity={sessionIdentity}
        question={question}
        disabled={false}
        isSubmitting={false}
        onSubmit={async () => {}}
      />,
    );
    fireEvent.change(first.getByLabelText(`Answer: ${question.title}`), {
      target: { value: "Session one draft" },
    });
    first.unmount();

    const secondIdentity = { ...sessionIdentity, workingDirectory: "/other-repo" };
    const second = render(
      <AgentAsyncQuestionCard
        sessionIdentity={secondIdentity}
        question={question}
        disabled={false}
        isSubmitting={false}
        onSubmit={async () => {}}
      />,
    );
    const secondInput = second.getByLabelText(`Answer: ${question.title}`);
    if (!(secondInput instanceof HTMLInputElement)) throw new Error("Expected an answer input.");
    expect(secondInput.value).toBe("");
    fireEvent.change(secondInput, { target: { value: "Session two draft" } });
    second.unmount();

    const restored = render(
      <AgentAsyncQuestionCard
        sessionIdentity={sessionIdentity}
        question={question}
        disabled={false}
        isSubmitting={false}
        onSubmit={async () => {}}
      />,
    );
    const restoredInput = restored.getByLabelText(`Answer: ${question.title}`);
    if (!(restoredInput instanceof HTMLInputElement)) throw new Error("Expected an answer input.");
    expect(restoredInput.value).toBe("Session one draft");
  });

  test("clears only the accepted question draft", async () => {
    const firstQuestion = {
      questionItemId: '["request_user_input_async","message-pair",0]',
      sourceMessageId: "message-pair",
      questionIndex: 0,
      title: "First question?",
      options: null,
    };
    const secondQuestion = {
      ...firstQuestion,
      questionItemId: '["request_user_input_async","message-pair",1]',
      questionIndex: 1,
      title: "Second question?",
    };
    const view = render(
      <>
        <AgentAsyncQuestionCard
          sessionIdentity={sessionIdentity}
          question={firstQuestion}
          disabled={false}
          isSubmitting={false}
          onSubmit={async () => {}}
        />
        <AgentAsyncQuestionCard
          sessionIdentity={sessionIdentity}
          question={secondQuestion}
          disabled={false}
          isSubmitting={false}
          onSubmit={async () => {}}
        />
      </>,
    );
    fireEvent.change(view.getByLabelText(`Answer: ${firstQuestion.title}`), {
      target: { value: "First answer" },
    });
    fireEvent.change(view.getByLabelText(`Answer: ${secondQuestion.title}`), {
      target: { value: "Second answer" },
    });
    fireEvent.click(view.getAllByRole("button", { name: "Send" })[0]!);

    await waitFor(() => {
      const firstInput = view.getByLabelText(`Answer: ${firstQuestion.title}`);
      const secondInput = view.getByLabelText(`Answer: ${secondQuestion.title}`);
      if (!(firstInput instanceof HTMLInputElement) || !(secondInput instanceof HTMLInputElement)) {
        throw new Error("Expected answer inputs.");
      }
      expect(firstInput.value).toBe("");
      expect(secondInput.value).toBe("Second answer");
    });
  });

  test("retains a draft when delivery fails", async () => {
    const question = {
      questionItemId: '["request_user_input_async","message-rejected",0]',
      sourceMessageId: "message-rejected",
      questionIndex: 0,
      title: "Which environment should I use after a failure?",
      options: null,
    };
    const onSubmit = mock(async () => {
      throw new Error("turn start rejected");
    });
    const view = render(
      <AgentAsyncQuestionCard
        sessionIdentity={sessionIdentity}
        question={question}
        disabled={false}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );
    const input = view.getByLabelText(`Answer: ${question.title}`);
    fireEvent.change(input, { target: { value: "Keep this answer" } });
    fireEvent.click(view.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    if (!(input instanceof HTMLInputElement)) throw new Error("Expected an answer input.");
    expect(input.value).toBe("Keep this answer");
  });

  test("removes only a question resolved by another client", () => {
    const firstQuestion = {
      questionItemId: '["request_user_input_async","message-remote",0]',
      sourceMessageId: "message-remote",
      questionIndex: 0,
      title: "Remote first question?",
      options: null,
    };
    const secondQuestion = {
      ...firstQuestion,
      questionItemId: '["request_user_input_async","message-remote",1]',
      questionIndex: 1,
      title: "Remote second question?",
    };
    pruneAgentAsyncQuestionDrafts(sessionIdentity, [
      firstQuestion.questionItemId,
      secondQuestion.questionItemId,
    ]);
    const initial = render(
      <>
        <AgentAsyncQuestionCard
          sessionIdentity={sessionIdentity}
          question={firstQuestion}
          disabled={false}
          isSubmitting={false}
          onSubmit={async () => {}}
        />
        <AgentAsyncQuestionCard
          sessionIdentity={sessionIdentity}
          question={secondQuestion}
          disabled={false}
          isSubmitting={false}
          onSubmit={async () => {}}
        />
      </>,
    );
    fireEvent.change(initial.getByLabelText(`Answer: ${firstQuestion.title}`), {
      target: { value: "First remote draft" },
    });
    fireEvent.change(initial.getByLabelText(`Answer: ${secondQuestion.title}`), {
      target: { value: "Second remote draft" },
    });
    initial.unmount();

    pruneAgentAsyncQuestionDrafts(sessionIdentity, [secondQuestion.questionItemId]);
    const restored = render(
      <>
        <AgentAsyncQuestionCard
          sessionIdentity={sessionIdentity}
          question={firstQuestion}
          disabled={false}
          isSubmitting={false}
          onSubmit={async () => {}}
        />
        <AgentAsyncQuestionCard
          sessionIdentity={sessionIdentity}
          question={secondQuestion}
          disabled={false}
          isSubmitting={false}
          onSubmit={async () => {}}
        />
      </>,
    );
    const firstInput = restored.getByLabelText(`Answer: ${firstQuestion.title}`);
    const secondInput = restored.getByLabelText(`Answer: ${secondQuestion.title}`);
    if (!(firstInput instanceof HTMLInputElement) || !(secondInput instanceof HTMLInputElement)) {
      throw new Error("Expected answer inputs.");
    }
    expect(firstInput.value).toBe("");
    expect(secondInput.value).toBe("Second remote draft");
  });

  test("clears drafts when the session store removes the session", () => {
    const question = {
      questionItemId: '["request_user_input_async","message-removed",0]',
      sourceMessageId: "message-removed",
      questionIndex: 0,
      title: "Which draft should be cleared?",
      options: null,
    };
    const initial = render(
      <AgentAsyncQuestionCard
        sessionIdentity={sessionIdentity}
        question={question}
        disabled={false}
        isSubmitting={false}
        onSubmit={async () => {}}
      />,
    );
    fireEvent.change(initial.getByLabelText(`Answer: ${question.title}`), {
      target: { value: "Remove this draft" },
    });
    initial.unmount();

    const store = createAgentSessionsStore();
    const session = createAgentSessionFixture(sessionIdentity);
    store.replaceSession(session);
    store.removeSession(session);

    const restored = render(
      <AgentAsyncQuestionCard
        sessionIdentity={sessionIdentity}
        question={question}
        disabled={false}
        isSubmitting={false}
        onSubmit={async () => {}}
      />,
    );
    const input = restored.getByLabelText(`Answer: ${question.title}`);
    if (!(input instanceof HTMLInputElement)) throw new Error("Expected an answer input.");
    expect(input.value).toBe("");
  });
});
