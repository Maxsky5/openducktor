import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { questionToolDetails } from "./question-tool-parser";

const createToolMeta = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  ...overrides,
});

describe("questionToolDetails", () => {
  const plainQuestion = (prompt: string, answers: string[]) => ({
    prompt,
    header: null,
    options: [],
    multiple: false,
    answers,
  });

  test("returns empty details for non-question tools and empty question payloads", () => {
    expect(questionToolDetails(createToolMeta({ tool: "read" }))).toEqual([]);
    expect(
      questionToolDetails(
        createToolMeta({
          tool: "question_parser",
          toolType: "generic" as const,
          metadata: { questions: [{ question: "Should be ignored" }] },
        }),
      ),
    ).toEqual([]);
    expect(
      questionToolDetails(
        createToolMeta({ tool: "question", toolType: "question", output: "{broken" }),
      ),
    ).toEqual([]);
    expect(
      questionToolDetails(
        createToolMeta({ tool: "question", toolType: "question", output: "plain text" }),
      ),
    ).toEqual([]);
    expect(
      questionToolDetails(createToolMeta({ tool: "question", toolType: "question", metadata: {} })),
    ).toEqual([]);
  });

  test("prefers input questions over metadata and output questions", () => {
    const details = questionToolDetails(
      createToolMeta({
        tool: "QUESTION",
        toolType: "question",
        input: {
          questions: [{ question: "Choose role", answers: ["planner"] }],
        },
        metadata: {
          questions: [{ question: "Ignored metadata question" }],
        },
        output: JSON.stringify({
          questions: [{ question: "Ignored output question" }],
          answers: [["build"]],
        }),
      }),
    );
    expect(details).toEqual([plainQuestion("Choose role", ["planner"])]);
  });

  test("uses metadata questions and normalizes object answer groups", () => {
    const details = questionToolDetails(
      createToolMeta({
        tool: "my_question",
        toolType: "question",
        metadata: {
          questions: [{ title: "Environment?" }],
          answers: {
            first: [" staging ", " "],
            second: "prod",
          },
        },
      }),
    );

    expect(details).toEqual([plainQuestion("Environment?", ["staging"])]);
  });

  test("uses output questions and nested response answer groups", () => {
    const details = questionToolDetails(
      createToolMeta({
        tool: "question",
        toolType: "question",
        output: JSON.stringify({
          questions: [{ header: "Pick first" }, { label: "Pick second" }],
          response: [{ value: "alpha" }, { value: ["beta", "  "] }],
        }),
      }),
    );

    expect(details).toEqual([
      plainQuestion("Pick first", ["alpha"]),
      plainQuestion("Pick second", ["beta"]),
    ]);
  });

  test("falls back to metadata answer groups when output answers are absent", () => {
    const details = questionToolDetails(
      createToolMeta({
        tool: "question",
        toolType: "question",
        metadata: {
          questions: [{ question: "Approve?" }],
          answers: [["yes"]],
        },
      }),
    );

    expect(details).toEqual([plainQuestion("Approve?", ["yes"])]);
  });

  test("returns prompts with empty answers when no answer groups exist", () => {
    const details = questionToolDetails(
      createToolMeta({
        tool: "question",
        toolType: "question",
        input: {
          questions: [{ question: "Anything else?" }],
        },
      }),
    );
    expect(details).toEqual([plainQuestion("Anything else?", [])]);
  });

  test("ignores malformed question entries before valid prompts", () => {
    const details = questionToolDetails(
      createToolMeta({
        tool: "question",
        toolType: "question",
        metadata: {
          questions: [null, { foo: "bar" }, { question: "Final prompt" }],
        },
      }),
    );

    expect(details).toEqual([plainQuestion("Final prompt", [])]);
  });
  test("reads the header, options, and multiple choice flag of each question", () => {
    const details = questionToolDetails(
      createToolMeta({
        tool: "AskUserQuestion",
        toolType: "question",
        input: {
          questions: [
            {
              question: "Which checks?",
              header: "Checks",
              multiSelect: true,
              options: [{ label: "Lint", description: "Run oxlint" }, { label: "Test" }],
            },
            {
              question: "Which branch?",
              header: "Which branch?",
              multiple: false,
              options: ["main"],
            },
          ],
        },
      }),
    );

    expect(details).toEqual([
      {
        prompt: "Which checks?",
        header: "Checks",
        options: [
          { label: "Lint", description: "Run oxlint" },
          { label: "Test", description: null },
        ],
        multiple: true,
        answers: [],
      },
      {
        prompt: "Which branch?",
        header: null,
        options: [{ label: "main", description: null }],
        multiple: false,
        answers: [],
      },
    ]);
  });

  test("keeps the place of a question without an answer in grouped answers", () => {
    const prompts = (answers: NonNullable<ToolMeta["metadata"]>) =>
      questionToolDetails(
        createToolMeta({
          tool: "question",
          toolType: "question",
          input: { questions: [{ question: "First?" }, { question: "Second?" }] },
          metadata: answers,
        }),
      ).map(({ prompt, answers }) => ({ prompt, answers }));
    const expected = [
      { prompt: "First?", answers: [] },
      { prompt: "Second?", answers: ["Yes"] },
    ];

    // OpenCode and Claude give a group for each question, and Codex a record by question id.
    expect(prompts({ answers: [[], ["Yes"]] })).toEqual(expected);
    expect(prompts({ answers: { q1: { answers: [] }, q2: { answers: ["Yes"] } } })).toEqual(
      expected,
    );
  });
});
