import { describe, expect, test } from "bun:test";
import type { WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import { createTaskCardFixture } from "../test-utils";
import { createPrepareSessionSend } from "./prepare-session-send";
import { buildSession } from "./session-actions.test-helpers";

type BuildSessionOverrides = Parameters<typeof buildSession>[0];

const buildWorkflowSession = (overrides: BuildSessionOverrides = {}): WorkflowAgentSessionState => {
  const session = buildSession({
    ...overrides,
    sessionAssociation:
      overrides.sessionAssociation ??
      ({ kind: "workflow", taskId: "task-1", role: "build" } as const),
  });
  if (session.sessionAssociation.kind !== "workflow") {
    throw new Error("Workflow session fixtures require a workflow association.");
  }
  return { ...session, sessionAssociation: session.sessionAssociation };
};

const createPrepareSend = (
  overrides: Partial<Parameters<typeof createPrepareSessionSend>[0]> = {},
) => {
  const promptOverrideReads: string[] = [];

  return {
    promptOverrideReads,
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
      loadRepoPromptOverrides: async (workspaceId) => {
        promptOverrideReads.push(workspaceId);
        return {};
      },
      ...overrides,
    }),
  };
};

describe("prepare session send", () => {
  test("builds the durable session prompt from the task and workspace prompt overrides", async () => {
    const { promptOverrideReads, prepareSend } = createPrepareSend();

    const result = await prepareSend(buildWorkflowSession({ status: "idle" }), {
      prepareWorkflowContext: true,
    });

    expect(result.systemPrompt).toContain("Build login");
    expect(promptOverrideReads).toEqual(["workspace-1"]);
  });

  test("rejects when the workspace changes during prompt preparation", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" };
    const { prepareSend } = createPrepareSend({
      currentWorkspaceRepoPathRef,
      loadRepoPromptOverrides: async () => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
        return {};
      },
    });

    await expect(
      prepareSend(buildWorkflowSession({ status: "idle" }), {
        prepareWorkflowContext: true,
      }),
    ).rejects.toThrow("Workspace changed while preparing session send.");
  });

  test("sends a repository session when the active workspace has changed", async () => {
    const { promptOverrideReads, prepareSend } = createPrepareSend({
      currentWorkspaceRepoPathRef: { current: "/tmp/other" },
    });

    const result = await prepareSend(buildSession({ sessionAssociation: { kind: "repository" } }), {
      prepareWorkflowContext: true,
    });

    expect(result).toEqual({});
    expect(promptOverrideReads).toEqual([]);
  });
});
