import { describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import {
  createSessionStartWorkflowRunner,
  type SessionStartNotificationPublisher,
} from "./session-start-orchestration";

const selection = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build-agent",
};

const session = {
  externalSessionId: "session-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
};

const createPublisher = (): SessionStartNotificationPublisher => ({
  publishSessionStarted: mock(() => {}),
  publishSessionError: mock(() => {}),
  reportFailure: mock(() => {}),
});

const baseInput = {
  request: {
    taskId: "task-1",
    role: "build" as const,
    launchActionId: "build_implementation_start" as const,
    postStartAction: "none" as const,
  },
  decision: { startMode: "fresh" as const, selectedModel: selection },
  task: createTaskCardFixture({ id: "task-1", title: "Build notifications" }),
};

describe("session-start notifications", () => {
  test("publishes Started only for a successful fresh or fork start", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => session),
      notifications,
      createLaunchAttemptId: () => "launch-1",
    });

    await runner(baseInput);

    expect(notifications.publishSessionStarted).toHaveBeenCalledWith({
      launchAttemptId: "launch-1",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskTitle: "Build notifications",
      role: "build",
      session,
    });
    expect(notifications.publishSessionError).not.toHaveBeenCalled();
  });

  test("does not publish Started for reuse", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => session),
      notifications,
      createLaunchAttemptId: () => "launch-reuse",
    });

    await runner({
      ...baseInput,
      decision: { startMode: "reuse", sourceSession: session },
    });

    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
    expect(notifications.publishSessionError).not.toHaveBeenCalled();
  });

  test("publishes one task-only Session Error when creation fails", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => {
        throw new Error("start failed");
      }),
      notifications,
      createLaunchAttemptId: () => "launch-error",
    });

    await expect(runner(baseInput)).rejects.toThrow("start failed");
    expect(notifications.publishSessionError).toHaveBeenCalledWith({
      launchAttemptId: "launch-error",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskTitle: "Build notifications",
      role: "build",
    });
    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
  });

  test("publishes only Session Error when the post-start message fails", async () => {
    const notifications = createPublisher();
    const runner = createSessionStartWorkflowRunner({
      queryClient: new QueryClient(),
      workspaceId: "workspace-1",
      startAgentSession: mock(async () => session),
      sendAgentMessage: mock(async () => {
        throw new Error("message failed");
      }),
      notifications,
      createLaunchAttemptId: () => "launch-post-error",
    });

    await runner({
      ...baseInput,
      request: {
        ...baseInput.request,
        postStartAction: "send_message",
        message: "Continue",
      },
    });

    expect(notifications.publishSessionError).toHaveBeenCalledWith(
      expect.objectContaining({ launchAttemptId: "launch-post-error", session }),
    );
    expect(notifications.publishSessionStarted).not.toHaveBeenCalled();
  });
});
