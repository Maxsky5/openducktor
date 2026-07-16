import { describe, expect, test } from "bun:test";
import type { WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import { createTaskCardFixture } from "../test-utils";
import { createPrepareSessionSend } from "./prepare-session-send";
import { buildSession } from "./session-actions.test-helpers";

type BuildSessionOverrides = Parameters<typeof buildSession>[0];

const buildWorkflowSession = (
  overrides: BuildSessionOverrides = {},
): WorkflowAgentSessionState => ({
  ...buildSession({
    ...overrides,
    role: overrides.role ?? "build",
  }),
  role: overrides.role ?? "build",
});

const createPrepareSend = (
  overrides: Partial<Parameters<typeof createPrepareSessionSend>[0]> = {},
) => {
  const ensureExistingRuntimeCalls: unknown[] = [];

  return {
    ensureExistingRuntimeCalls,
    prepareSend: createPrepareSessionSend({
      workspaceRepoPath: "/tmp/repo",
      workspaceId: "workspace-1",
      repoEpochRef: { current: 1 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            title: "Build login",
            description: "Implement login",
            status: "in_progress",
            aiReviewEnabled: true,
          }),
        ],
      },
      ensureExistingSessionRuntime: async (...args) => {
        ensureExistingRuntimeCalls.push(args);
      },
      loadRepoPromptOverrides: async () => ({}),
      ...overrides,
    }),
  };
};

describe("prepare session send", () => {
  test("ensures the session runtime and builds the durable session prompt", async () => {
    const { ensureExistingRuntimeCalls, prepareSend } = createPrepareSend();

    const result = await prepareSend(buildWorkflowSession({ status: "idle" }));

    expect(result.repoPath).toBe("/tmp/repo");
    expect(result.systemPrompt).toContain("Build login");
    expect(ensureExistingRuntimeCalls).toEqual([["/tmp/repo", "opencode"]]);
  });

  test("rejects when the workspace changes during runtime preparation", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const { prepareSend } = createPrepareSend({
      currentWorkspaceRepoPathRef,
      ensureExistingSessionRuntime: async () => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
      },
    });

    await expect(prepareSend(buildWorkflowSession({ status: "idle" }))).rejects.toThrow(
      "Workspace changed while preparing session send.",
    );
  });
});
