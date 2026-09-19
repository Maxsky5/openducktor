import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { AgentAsyncQuestionCard } from "./agent-async-question-card";

describe("AgentAsyncQuestionCard", () => {
  test("offers suggestions and accepts free text without external draft state", async () => {
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
});
