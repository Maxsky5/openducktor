import { describe, expect, test } from "bun:test";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { buildQuestionDraftKey } from "./agent-session-question-keys";

const buildRequest = (overrides: Partial<AgentQuestionRequest> = {}): AgentQuestionRequest => ({
  requestId: "request-1",
  questions: [
    {
      header: "Scope",
      question: "Which area should we prioritize?",
      options: [
        { label: "Frontend", description: "UI and interaction work" },
        { label: "Backend", description: "Services and persistence" },
      ],
      multiple: false,
    },
  ],
  ...overrides,
});

describe("buildQuestionDraftKey", () => {
  test("ignores the request id", () => {
    const request = buildRequest();
    expect(buildQuestionDraftKey({ ...request, requestId: "request-2" })).toBe(
      buildQuestionDraftKey(request),
    );
  });

  test("changes when the question content changes", () => {
    const request = buildRequest();
    const changed = buildRequest({
      questions: [
        {
          header: "Scope",
          question: "Which area should we prioritize first?",
          options: request.questions[0]?.options ?? [],
          multiple: false,
        },
      ],
    });
    expect(buildQuestionDraftKey(changed)).not.toBe(buildQuestionDraftKey(request));
  });

  test("separates subagent questions from direct questions", () => {
    const request = buildRequest();
    const subagent = buildRequest({
      source: {
        kind: "subagent",
        parentExternalSessionId: "parent-session",
        childExternalSessionId: "child-session",
      },
    });
    expect(buildQuestionDraftKey(subagent)).not.toBe(buildQuestionDraftKey(request));
  });
});
