import { describe, expect, mock, test } from "bun:test";
import type { AgentKickoffTemplateId } from "@openducktor/core";
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
  test.each(CONTEXT_FREE_TEMPLATES)("returns no context for %s", async (templateId) => {
    const loadRepoDefaultTargetBranch = mock(async () => ({
      remote: "origin",
      branch: "main",
    }));

    await expect(
      resolveSessionStartKickoffPromptContext({
        templateId,
        loadRepoDefaultTargetBranch,
      }),
    ).resolves.toEqual({});
    expect(loadRepoDefaultTargetBranch).not.toHaveBeenCalled();
  });

  test("maps human review feedback to its prompt placeholder", async () => {
    await expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "kickoff.build_after_human_request_changes",
        message: "  Address every review comment.  ",
        loadRepoDefaultTargetBranch: mock(async () => null),
      }),
    ).resolves.toEqual({
      extraPlaceholders: {
        humanFeedback: "Address every review comment.",
      },
    });
  });

  test("rejects missing human review feedback", async () => {
    await expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "kickoff.build_after_human_request_changes",
        message: "   ",
        loadRepoDefaultTargetBranch: mock(async () => null),
      }),
    ).rejects.toThrow(FEEDBACK_MESSAGE_REQUIRED_ERROR);
  });

  test("maps the selected pull request target into nested Git context", async () => {
    const loadRepoDefaultTargetBranch = mock(async () => ({
      remote: "origin",
      branch: "main",
    }));

    await expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "kickoff.build_pull_request_generation",
        taskTargetBranch: {
          remote: "upstream",
          branch: "release/2026.04",
        },
        loadRepoDefaultTargetBranch,
      }),
    ).resolves.toEqual({
      git: {
        targetBranch: {
          remote: "upstream",
          branch: "release/2026.04",
        },
      },
    });
    expect(loadRepoDefaultTargetBranch).toHaveBeenCalledTimes(1);
  });

  test("uses the repository default for pull request context when the task has no target", async () => {
    await expect(
      resolveSessionStartKickoffPromptContext({
        templateId: "kickoff.build_pull_request_generation",
        loadRepoDefaultTargetBranch: mock(async () => ({
          remote: "upstream",
          branch: "develop",
        })),
      }),
    ).resolves.toEqual({
      git: {
        targetBranch: {
          remote: "upstream",
          branch: "develop",
        },
      },
    });
  });
});
