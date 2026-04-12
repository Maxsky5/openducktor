import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { startSessionWorkflow } from "./session-start-workflow";

const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build-agent",
};

describe("session-start-workflow", () => {
  test("aborts before session creation when the before-start action fails", async () => {
    const startAgentSession = mock(async () => "session-new");
    const humanRequestChangesTask = mock(async () => {
      throw new Error("cannot request changes");
    });

    await expect(
      startSessionWorkflow({
        activeRepo: "/repo",
        queryClient: new QueryClient(),
        intent: {
          taskId: "TASK-1",
          role: "build",
          scenario: "build_after_human_request_changes",
          startMode: "fresh",
          postStartAction: "none",
          beforeStartAction: {
            action: "human_request_changes",
            note: "Need more work",
          },
        },
        selection: BUILD_SELECTION,
        task: null,
        startAgentSession,
        humanRequestChangesTask,
      }),
    ).rejects.toThrow("cannot request changes");

    expect(startAgentSession).not.toHaveBeenCalled();
  });

  test("forwards explicit target working directory for fresh starts", async () => {
    const startAgentSession = mock(async () => "session-new");

    const result = await startSessionWorkflow({
      activeRepo: "/repo",
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-1",
        role: "build",
        scenario: "build_rebase_conflict_resolution",
        startMode: "fresh",
        postStartAction: "none",
        targetWorkingDirectory: "/repo/worktrees/conflict-task-1",
      },
      selection: BUILD_SELECTION,
      task: null,
      startAgentSession,
    });

    expect(result).toEqual({
      sessionId: "session-new",
      postStartActionError: null,
    });
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "fresh",
        targetWorkingDirectory: "/repo/worktrees/conflict-task-1",
      }),
    );
  });

  test("uses the just-selected target branch for pull request kickoff prompts", async () => {
    const sendAgentMessage = mock(async () => undefined);
    const startAgentSession = mock(async () => "session-pr");

    const result = await startSessionWorkflow({
      activeRepo: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-2",
        role: "build",
        scenario: "build_pull_request_generation",
        startMode: "reuse",
        sourceSessionId: "builder-session-1",
        targetBranch: {
          remote: "origin",
          branch: "release/2026.04",
        },
        postStartAction: "kickoff",
      },
      selection: null,
      task: createTaskCardFixture({
        id: "TASK-2",
        title: "Generate PR",
        description: "desc",
        status: "in_progress",
        priority: 1,
        targetBranch: {
          remote: "origin",
          branch: "main",
        },
      }),
      startAgentSession,
      sendAgentMessage,
    });

    expect(result).toEqual({
      sessionId: "session-pr",
      postStartActionError: null,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith("session-pr", [
      expect.objectContaining({
        kind: "text",
        text: expect.stringContaining("targetBranch: origin/release/2026.04"),
      }),
    ]);
    const sentCalls = sendAgentMessage.mock.calls as unknown as Array<
      [string, Array<{ text?: string }>]
    >;
    const sentText = sentCalls[0]?.[1]?.[0]?.text ?? "";
    expect(sentText).not.toContain("targetBranch: origin/main");
  });
});
