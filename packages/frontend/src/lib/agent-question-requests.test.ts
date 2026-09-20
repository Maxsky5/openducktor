import { describe, expect, test } from "bun:test";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { toAgentQuestionRequests } from "./agent-question-requests";

describe("toAgentQuestionRequests", () => {
  test("groups one Codex message into one standard question request", () => {
    const blockingRequest: AgentQuestionRequest = {
      requestId: "blocking-1",
      questions: [],
    };

    expect(
      toAgentQuestionRequests(
        [blockingRequest],
        [
          {
            questionItemId: "question-2",
            sourceMessageId: "message-1",
            questionIndex: 1,
            title: "Which suite?",
            options: null,
          },
          {
            questionItemId: "question-1",
            sourceMessageId: "message-1",
            questionIndex: 0,
            title: "Which environment?",
            options: ["Staging", "Production"],
          },
        ],
      ),
    ).toEqual([
      blockingRequest,
      {
        requestId: "async:message-1",
        asyncQuestionItemIds: ["question-1", "question-2"],
        questions: [
          {
            header: "",
            question: "Which environment?",
            options: [
              { label: "Staging", description: "" },
              { label: "Production", description: "" },
            ],
          },
          {
            header: "",
            question: "Which suite?",
            options: [],
          },
        ],
      },
    ]);
  });

  test("keeps the blocking request list when Codex has no background questions", () => {
    const requests: AgentQuestionRequest[] = [{ requestId: "blocking-1", questions: [] }];

    expect(toAgentQuestionRequests(requests, [])).toBe(requests);
  });
});
