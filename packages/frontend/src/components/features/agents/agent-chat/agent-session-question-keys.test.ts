import { describe, expect, test } from "bun:test";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { buildQuestionCardKey, buildQuestionContentEntries } from "./agent-session-question-keys";

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

const baseQuestion = (
  overrides: Partial<AgentQuestionRequest["questions"][number]> = {},
): AgentQuestionRequest["questions"][number] => ({
  header: "Scope",
  question: "Which area should we prioritize?",
  options: [{ label: "Frontend", description: "UI and interaction work" }],
  multiple: false,
  ...overrides,
});

describe("buildQuestionCardKey", () => {
  test("keeps the key when the same request is re-projected", () => {
    const request = buildRequest();
    expect(buildQuestionCardKey("session-1", structuredClone(request))).toBe(
      buildQuestionCardKey("session-1", request),
    );
  });

  test("changes the key when the request id changes", () => {
    const request = buildRequest();
    expect(buildQuestionCardKey("session-1", { ...request, requestId: "request-2" })).not.toBe(
      buildQuestionCardKey("session-1", request),
    );
  });

  test("separates requests from different sessions", () => {
    const request = buildRequest();
    expect(buildQuestionCardKey("session-2", request)).not.toBe(
      buildQuestionCardKey("session-1", request),
    );
  });
});

describe("buildQuestionContentEntries", () => {
  test("builds content keys that do not change with object identity", () => {
    const request = buildRequest();
    expect(buildQuestionContentEntries(structuredClone(request.questions))).toEqual(
      buildQuestionContentEntries(request.questions),
    );
  });

  test("gives identical questions in one request distinct content keys", () => {
    const request = buildRequest({ questions: [baseQuestion(), baseQuestion()] });
    const [first, second] = buildQuestionContentEntries(request.questions);

    expect(first?.contentKey).not.toBe(second?.contentKey);
  });
});
