import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import {
  createSettingsSnapshotFixture,
  createTaskCardFixture,
} from "@/test-utils/shared-test-fixtures";
import { startSessionWorkflow } from "./session-start-workflow";

type SendAgentMessage = NonNullable<Parameters<typeof startSessionWorkflow>[0]["sendAgentMessage"]>;

const createSendAgentMessageMock = () =>
  mock(
    async (_session: Parameters<SendAgentMessage>[0], _segments: Parameters<SendAgentMessage>[1]) =>
      undefined,
  );

const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build-agent",
};

const CODEX_BUILD_SELECTION = {
  ...BUILD_SELECTION,
  runtimeKind: "codex" as const,
  providerId: "codex",
  variant: "medium",
};

const sessionIdentity = (
  externalSessionId: string,
  runtimeKind: "opencode" | "codex" = "opencode",
) => ({
  externalSessionId,
  runtimeKind,
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

describe("session-start-workflow", () => {
  test("aborts before session creation when the before-start action fails", async () => {
    const startAgentSession = mock(async () => sessionIdentity("session-new"));
    const humanRequestChangesTask = mock(async () => {
      throw new Error("cannot request changes");
    });

    await expect(
      startSessionWorkflow({
        workspaceId: "workspace-1",
        queryClient: new QueryClient(),
        intent: {
          taskId: "TASK-1",
          role: "build",
          launchActionId: "build_implementation_start",
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
    const startAgentSession = mock(async () => sessionIdentity("session-new"));

    const result = await startSessionWorkflow({
      workspaceId: "workspace-1",
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-1",
        role: "build",
        launchActionId: "build_implementation_start",
        startMode: "fresh",
        postStartAction: "none",
        targetWorkingDirectory: "/repo/worktrees/conflict-task-1",
      },
      selection: BUILD_SELECTION,
      task: null,
      startAgentSession,
    });

    expect(result).toEqual({
      ...sessionIdentity("session-new"),
      postStartActionError: null,
    });
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "fresh",
        targetWorkingDirectory: "/repo/worktrees/conflict-task-1",
        holdForPostStartMessage: false,
      }),
    );
  });

  test("uses the just-selected target branch for pull request kickoff prompts", async () => {
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-pr"));

    const result = await startSessionWorkflow({
      workspaceId: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-2",
        role: "build",
        launchActionId: "build_pull_request_generation",
        startMode: "reuse",
        sourceSession: {
          externalSessionId: "builder-session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        targetBranch: {
          remote: "upstream",
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
      ...sessionIdentity("session-pr"),
      postStartActionError: null,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-pr"), [
      expect.objectContaining({
        kind: "text",
        text: expect.stringContaining("Pull request base:\nrelease/2026.04"),
      }),
    ]);
    const sentText =
      sendAgentMessage.mock.calls[0]?.[1]?.find((part) => part.kind === "text")?.text ?? "";
    expect(sentText).not.toContain("upstream/release/2026.04");
  });

  test("ignores the remote when building the pull request kickoff prompt", async () => {
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-pr-origin"));

    await startSessionWorkflow({
      workspaceId: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-ORIGIN",
        role: "build",
        launchActionId: "build_pull_request_generation",
        startMode: "reuse",
        sourceSession: sessionIdentity("builder-session-origin"),
        postStartAction: "kickoff",
      },
      selection: null,
      task: createTaskCardFixture({
        id: "TASK-ORIGIN",
        title: "Generate origin PR",
        targetBranch: {
          remote: "origin",
          branch: "main",
        },
      }),
      startAgentSession,
      sendAgentMessage,
    });

    const sentText =
      sendAgentMessage.mock.calls[0]?.[1]?.find((part) => part.kind === "text")?.text ?? "";
    expect(sentText).toContain("Pull request base:\nmain");
    expect(sentText).not.toContain("origin/main");
  });

  test("uses the repository default target for a forked pull request kickoff", async () => {
    const queryClient = new QueryClient();
    const repoConfig = {
      workspaceId: "workspace-pr",
      workspaceName: "PR workspace",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      branchPrefix: "odt",
      defaultTargetBranch: {
        remote: "upstream",
        branch: "develop",
      },
      git: {},
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeCopyPaths: [],
      promptOverrides: {},
      agentStudioState: { openTaskIds: [] },
      agentDefaults: {},
    } satisfies RepoConfig;
    queryClient.setQueryData(workspaceQueryKeys.repoConfig("workspace-pr"), repoConfig);
    queryClient.setQueryData(
      workspaceQueryKeys.settingsSnapshot(),
      createSettingsSnapshotFixture({
        workspaces: {
          "workspace-pr": repoConfig,
        },
      }),
    );
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-pr-fork"));
    const sourceSession = sessionIdentity("builder-session-fork");

    await startSessionWorkflow({
      workspaceId: "workspace-pr",
      queryClient,
      intent: {
        taskId: "TASK-FORK",
        role: "build",
        launchActionId: "build_pull_request_generation",
        startMode: "fork",
        sourceSession,
        postStartAction: "kickoff",
      },
      selection: BUILD_SELECTION,
      task: createTaskCardFixture({
        id: "TASK-FORK",
        title: "Fork for pull request",
      }),
      startAgentSession,
      sendAgentMessage,
    });

    expect(startAgentSession).toHaveBeenCalledWith({
      taskId: "TASK-FORK",
      role: "build",
      startMode: "fork",
      selectedModel: BUILD_SELECTION,
      sourceSession,
      holdForPostStartMessage: true,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-pr-fork"), [
      expect.objectContaining({
        kind: "text",
        text: expect.stringContaining("Pull request base:\ndevelop"),
      }),
    ]);
  });

  test("rejects upstream-relative targets before creating a pull request session", async () => {
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-pr-upstream"));

    await expect(
      startSessionWorkflow({
        workspaceId: null,
        queryClient: new QueryClient(),
        intent: {
          taskId: "TASK-UPSTREAM",
          role: "build",
          launchActionId: "build_pull_request_generation",
          startMode: "reuse",
          sourceSession: sessionIdentity("builder-session-upstream"),
          targetBranch: {
            branch: "@{upstream}",
          },
          postStartAction: "kickoff",
        },
        selection: null,
        task: createTaskCardFixture({
          id: "TASK-UPSTREAM",
          title: "Generate upstream PR",
        }),
        startAgentSession,
        sendAgentMessage,
      }),
    ).rejects.toThrow(
      "Pull request generation requires an explicit target branch; '@{upstream}' cannot identify a pull request base branch.",
    );

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  test("uses kickoff messaging with embedded human feedback for new builder sessions after review", async () => {
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-build-new"));

    const result = await startSessionWorkflow({
      workspaceId: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-3",
        role: "build",
        launchActionId: "build_after_human_request_changes",
        startMode: "fresh",
        postStartAction: "kickoff",
        message: "Update the acceptance criteria and rerun the desktop tests.",
        beforeStartAction: {
          action: "human_request_changes",
          note: "Update the acceptance criteria and rerun the desktop tests.",
        },
      },
      selection: BUILD_SELECTION,
      task: createTaskCardFixture({
        id: "TASK-3",
        title: "Address human review",
        description: "desc",
        status: "human_review",
        priority: 1,
      }),
      startAgentSession,
      sendAgentMessage,
      humanRequestChangesTask: mock(async () => undefined),
    });

    expect(result).toEqual({
      ...sessionIdentity("session-build-new"),
      postStartActionError: null,
    });
    const sentText =
      sendAgentMessage.mock.calls[0]?.[1]?.find((part) => part.kind === "text")?.text ?? "";
    expect(sentText).toContain("Requested changes from human review:");
    expect(sentText).toContain("Update the acceptance criteria and rerun the desktop tests.");
    expect(sentText).toContain("Use taskId TASK-3 for every odt_* tool call.");
  });

  test("holds fresh kickoff starts until the kickoff message send owns status", async () => {
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-build-new"));

    await startSessionWorkflow({
      workspaceId: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-4",
        role: "build",
        launchActionId: "build_implementation_start",
        startMode: "fresh",
        postStartAction: "kickoff",
      },
      selection: BUILD_SELECTION,
      task: createTaskCardFixture({
        id: "TASK-4",
        title: "Start implementation",
        description: "desc",
        status: "ready_for_dev",
        priority: 1,
      }),
      startAgentSession,
      sendAgentMessage,
    });

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "fresh",
        holdForPostStartMessage: true,
      }),
    );
    expect(sendAgentMessage).toHaveBeenCalledWith(
      sessionIdentity("session-build-new"),
      expect.arrayContaining([expect.objectContaining({ kind: "text" })]),
    );
  });

  test("holds message-first fresh starts until the composer send owns status", async () => {
    const startAgentSession = mock(async () => sessionIdentity("session-message-first"));

    await startSessionWorkflow({
      workspaceId: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-4",
        role: "build",
        launchActionId: "build_implementation_start",
        startMode: "fresh",
        postStartAction: "none",
        holdForPostStartMessage: true,
      },
      selection: BUILD_SELECTION,
      task: createTaskCardFixture({
        id: "TASK-4",
        title: "Start implementation",
        description: "desc",
        status: "ready_for_dev",
        priority: 1,
      }),
      startAgentSession,
    });

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "fresh",
        holdForPostStartMessage: true,
      }),
    );
  });

  test("does not complete a kickoff start before the kickoff message send settles", async () => {
    let resolveSendStarted: () => void = () => {};
    let resolveSend: () => void = () => {};
    const sendStarted = new Promise<void>((resolve) => {
      resolveSendStarted = resolve;
    });
    const sendFinished = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const sendAgentMessage = mock(async () => {
      resolveSendStarted();
      return sendFinished;
    });
    const startAgentSession = mock(async () => sessionIdentity("session-build-new"));

    const workflow = startSessionWorkflow({
      workspaceId: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-4",
        role: "build",
        launchActionId: "build_implementation_start",
        startMode: "fresh",
        postStartAction: "kickoff",
      },
      selection: BUILD_SELECTION,
      task: createTaskCardFixture({
        id: "TASK-4",
        title: "Start implementation",
        description: "desc",
        status: "ready_for_dev",
        priority: 1,
      }),
      startAgentSession,
      sendAgentMessage,
    });
    let completed = false;
    void workflow.then(() => {
      completed = true;
    });

    await sendStarted;

    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);

    resolveSend();
    await expect(workflow).resolves.toEqual({
      ...sessionIdentity("session-build-new"),
      postStartActionError: null,
    });
    expect(completed).toBe(true);
  });

  test("aborts before session creation when kickoff message construction fails", async () => {
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-build-new"));

    await expect(
      startSessionWorkflow({
        workspaceId: null,
        queryClient: new QueryClient(),
        intent: {
          taskId: "TASK-5",
          role: "build",
          launchActionId: "build_after_human_request_changes",
          startMode: "fresh",
          postStartAction: "kickoff",
        },
        selection: BUILD_SELECTION,
        task: createTaskCardFixture({
          id: "TASK-5",
          title: "Start implementation",
          description: "desc",
          status: "human_review",
          priority: 1,
        }),
        startAgentSession,
        sendAgentMessage,
      }),
    ).rejects.toThrow("Feedback message is required before sending.");

    expect(startAgentSession).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  test("sends Codex fresh kickoff through the standard post-start message path", async () => {
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-codex", "codex"));

    const result = await startSessionWorkflow({
      workspaceId: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-4",
        role: "build",
        launchActionId: "build_implementation_start",
        startMode: "fresh",
        postStartAction: "kickoff",
      },
      selection: CODEX_BUILD_SELECTION,
      task: createTaskCardFixture({
        id: "TASK-4",
        title: "Implement Codex",
        description: "desc",
        status: "ready_for_dev",
        priority: 1,
      }),
      startAgentSession,
      sendAgentMessage,
    });

    expect(result).toEqual({
      ...sessionIdentity("session-codex", "codex"),
      postStartActionError: null,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-codex", "codex"), [
      expect.objectContaining({
        kind: "text",
        text: expect.stringContaining("taskId TASK-4"),
      }),
    ]);
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "fresh",
        selectedModel: CODEX_BUILD_SELECTION,
        holdForPostStartMessage: true,
      }),
    );
  });

  test("sends Codex reuse kickoff through the standard post-start message path", async () => {
    const sendAgentMessage = createSendAgentMessageMock();
    const startAgentSession = mock(async () => sessionIdentity("session-codex-reuse", "codex"));

    const result = await startSessionWorkflow({
      workspaceId: null,
      queryClient: new QueryClient(),
      intent: {
        taskId: "TASK-5",
        role: "build",
        launchActionId: "build_implementation_start",
        startMode: "reuse",
        sourceSession: {
          externalSessionId: "session-codex-reuse",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        postStartAction: "kickoff",
      },
      selection: CODEX_BUILD_SELECTION,
      task: createTaskCardFixture({
        id: "TASK-5",
        title: "Continue Codex",
        description: "desc",
        status: "in_progress",
        priority: 1,
      }),
      startAgentSession,
      sendAgentMessage,
    });

    expect(result).toEqual({
      ...sessionIdentity("session-codex-reuse", "codex"),
      postStartActionError: null,
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(sessionIdentity("session-codex-reuse", "codex"), [
      expect.objectContaining({
        kind: "text",
        text: expect.stringContaining("taskId TASK-5"),
      }),
    ]);
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startMode: "reuse",
        sourceSession: {
          externalSessionId: "session-codex-reuse",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
      }),
    );
  });
});
