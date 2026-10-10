import { expect, mock, test } from "bun:test";
import type { WorkflowLaunchRequest, WorkflowLaunchSnapshot } from "@openducktor/contracts";
import { createStartAgentSession } from "./start-session";

const session = {
  externalSessionId: "session",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo/task",
  startedAt: "2026-10-03T12:00:00Z",
  status: "idle" as const,
};
test("preparation submits explicit identity to the host and sends no instruction", async () => {
  const launchWorkflow = mock(
    async (request: WorkflowLaunchRequest): Promise<WorkflowLaunchSnapshot> => ({
      launchAttemptId: request.launchAttemptId,
      workspaceId: request.workspaceId,
      repoPath: request.repoPath,
      taskId: request.taskId,
      role: "build",
      phase: "completed",
      acceptance: "not_submitted",
      ownershipSaved: true,
      completedPreStartActions: [],
      session,
    }),
  );
  const start = createStartAgentSession({
    repo: { workspaceId: "workspace", workspaceRepoPath: "/repo" },
    runtime: { launchWorkflow },
  });
  expect(
    await start({
      taskId: "task",
      role: "build",
      startMode: "fresh",
      selectedModel: { runtimeKind: "codex", providerId: "provider", modelId: "model" },
      targetWorkingDirectory: "/repo/task",
    }),
  ).toEqual({ externalSessionId: "session", runtimeKind: "codex", workingDirectory: "/repo/task" });
  expect(launchWorkflow.mock.calls[0]?.[0]).toMatchObject({
    workspaceId: "workspace",
    repoPath: "/repo",
    taskId: "task",
    instruction: { kind: "none" },
    targetWorkingDirectory: "/repo/task",
  });
});
test("a failed preparation reports the host error without launching again", async () => {
  const launchWorkflow = mock(
    async (request: WorkflowLaunchRequest): Promise<WorkflowLaunchSnapshot> => ({
      launchAttemptId: request.launchAttemptId,
      workspaceId: request.workspaceId,
      repoPath: request.repoPath,
      taskId: request.taskId,
      role: "build",
      phase: "failed",
      acceptance: "not_submitted",
      ownershipSaved: true,
      completedPreStartActions: [],
      session,
      failure: { stage: "publication", message: "Exact failure", cleanupErrors: [] },
    }),
  );
  const start = createStartAgentSession({
    repo: { workspaceId: "workspace", workspaceRepoPath: "/repo" },
    runtime: { launchWorkflow },
  });
  await expect(
    start({ taskId: "task", role: "build", startMode: "reuse", sourceSession: session }),
  ).rejects.toThrow("Exact failure");
  expect(launchWorkflow).toHaveBeenCalledTimes(1);
});
