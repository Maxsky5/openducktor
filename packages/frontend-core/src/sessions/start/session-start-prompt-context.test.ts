import { describe, expect, test } from "bun:test";
import {
  FEEDBACK_MESSAGE_REQUIRED_ERROR,
  resolveSessionStartKickoffPromptContext,
} from "./session-start-prompt-context";

const CONTEXT_FREE_TEMPLATES = [
  "messages.spec_start",
  "messages.plan_start",
  "messages.build_start",
  "messages.build_after_qa_rejection",
  "messages.qa_review",
];

describe("resolveSessionStartKickoffPromptContext", () => {
  test.each(CONTEXT_FREE_TEMPLATES)("returns no context for %s", (templateId) => {
    expect(
      resolveSessionStartKickoffPromptContext({
        templateId,
        context: "none",
        repoDefaultTargetBranch: { remote: "origin", branch: "main" },
      }),
    ).toEqual({});
  });

  test("maps human review feedback to its prompt placeholder", () => {
    expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "messages.build_requested_changes",
        context: "human_feedback",
        message: "  Address every review comment.  ",
        repoDefaultTargetBranch: null,
      }),
    ).toEqual({
      extraPlaceholders: {
        humanFeedback: "Address every review comment.",
      },
    });
  });

  test("rejects missing human review feedback", () => {
    expect(() =>
      resolveSessionStartKickoffPromptContext({
        templateId: "messages.build_requested_changes",
        context: "human_feedback",
        message: "   ",
        repoDefaultTargetBranch: null,
      }),
    ).toThrow(FEEDBACK_MESSAGE_REQUIRED_ERROR);
  });

  test("maps the selected pull request target into nested Git context", () => {
    expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "messages.build_pull_request",
        context: "pull_request",
        taskTargetBranch: {
          remote: "upstream",
          branch: "release/2026.04",
        },
        repoDefaultTargetBranch: { remote: "origin", branch: "main" },
      }),
    ).toEqual({
      git: {
        targetBranch: {
          remote: "upstream",
          branch: "release/2026.04",
        },
      },
    });
  });

  test("uses the repository default for pull request context when the task has no target", () => {
    expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "messages.build_pull_request",
        context: "pull_request",
        repoDefaultTargetBranch: { remote: "upstream", branch: "develop" },
      }),
    ).toEqual({
      git: {
        targetBranch: {
          remote: "upstream",
          branch: "develop",
        },
      },
    });
  });
});
