import { describe, expect, test } from "bun:test";
import type { AgentKickoffTemplateId } from "@openducktor/workflows";
import {
  FEEDBACK_MESSAGE_REQUIRED_ERROR,
  resolveSessionStartKickoffPromptContext,
} from "./session-start-prompt-context";

const CONTEXT_FREE_TEMPLATES: AgentKickoffTemplateId[] = [
  "kickoff.spec_initial",
  "kickoff.planner_initial",
  "kickoff.build_implementation_start",
  "kickoff.build_after_qa_rejected",
  "kickoff.qa_review",
];

describe("resolveSessionStartKickoffPromptContext", () => {
  test.each(CONTEXT_FREE_TEMPLATES)("returns no context for %s", (templateId) => {
    expect(
      resolveSessionStartKickoffPromptContext({
        templateId,
        repoDefaultTargetBranch: { remote: "origin", branch: "main" },
      }),
    ).toEqual({});
  });

  test("maps human review feedback to its prompt placeholder", () => {
    expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "kickoff.build_after_human_request_changes",
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
        templateId: "kickoff.build_after_human_request_changes",
        message: "   ",
        repoDefaultTargetBranch: null,
      }),
    ).toThrow(FEEDBACK_MESSAGE_REQUIRED_ERROR);
  });

  test("maps the selected pull request target into nested Git context", () => {
    expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "kickoff.build_pull_request_generation",
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
        templateId: "kickoff.build_pull_request_generation",
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
