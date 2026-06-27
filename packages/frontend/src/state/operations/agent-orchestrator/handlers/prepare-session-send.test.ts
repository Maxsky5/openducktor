import { describe, expect, test } from "bun:test";
import type { AgentSessionRuntimeRef } from "@openducktor/core";
import type { WorkflowAgentSessionState } from "@/types/agent-orchestrator";
import {
  createSessionObserversRefFixture,
  createTaskCardFixture,
  hasSessionObserverFixture,
} from "../test-utils";
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
  const observedRefs: AgentSessionRuntimeRef[] = [];
  const ensureRuntimeCalls: unknown[] = [];
  const sessionObserversRef = overrides.sessionObserversRef ?? createSessionObserversRefFixture();

  return {
    observedRefs,
    ensureRuntimeCalls,
    sessionObserversRef,
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
      sessionObserversRef,
      observeAgentSession: async (sessionRef) => {
        await sessionObserversRef.current.ensureObserver(sessionRef, async () => {
          observedRefs.push(sessionRef);
          return () => {};
        });
      },
      ensureRuntime: async (...args) => {
        ensureRuntimeCalls.push(args);
        return {
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
      loadRepoPromptOverrides: async () => ({}),
      ...overrides,
    }),
  };
};

describe("prepare session send", () => {
  test("ensures the session runtime and observes the exact durable session ref", async () => {
    const { ensureRuntimeCalls, observedRefs, prepareSend, sessionObserversRef } =
      createPrepareSend();

    const result = await prepareSend(buildWorkflowSession({ status: "idle" }));

    expect(result.repoPath).toBe("/tmp/repo");
    expect(result.systemPrompt).toContain("Build login");
    expect(ensureRuntimeCalls).toEqual([
      [
        "/tmp/repo",
        "task-1",
        "build",
        {
          workspaceId: "workspace-1",
          targetWorkingDirectory: "/tmp/repo/worktree",
          runtimeKind: "opencode",
        },
      ],
    ]);
    expect(observedRefs).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "session-1",
        taskId: "task-1",
        role: "build",
      },
    ]);
    expect(
      hasSessionObserverFixture(sessionObserversRef.current, {
        externalSessionId: "session-1",
      }),
    ).toBe(true);
  });

  test("keeps existing observers instead of subscribing twice", async () => {
    const sessionObserversRef = createSessionObserversRefFixture();
    await sessionObserversRef.current.ensureObserver(
      {
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
      },
      async () => () => {},
    );
    const { observedRefs, prepareSend } = createPrepareSend({ sessionObserversRef });

    await prepareSend(buildWorkflowSession({ status: "idle" }));

    expect(observedRefs).toEqual([]);
  });

  test("removes a newly-added observer when the workspace changes during preparation", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const sessionObserversRef = createSessionObserversRefFixture();
    const { prepareSend } = createPrepareSend({
      currentWorkspaceRepoPathRef,
      sessionObserversRef,
      observeAgentSession: async (sessionRef) => {
        await sessionObserversRef.current.ensureObserver(sessionRef, async () => () => {});
        currentWorkspaceRepoPathRef.current = "/tmp/other";
      },
    });

    await expect(prepareSend(buildWorkflowSession({ status: "idle" }))).rejects.toThrow(
      "Workspace changed while preparing session send.",
    );
    expect(
      hasSessionObserverFixture(sessionObserversRef.current, {
        externalSessionId: "session-1",
      }),
    ).toBe(false);
  });

  test("removes an existing observer when the workspace changes during preparation", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const sessionObserversRef = createSessionObserversRefFixture();
    const sessionRef = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
    };
    await sessionObserversRef.current.ensureObserver(sessionRef, async () => () => {});
    const { prepareSend } = createPrepareSend({
      currentWorkspaceRepoPathRef,
      sessionObserversRef,
      observeAgentSession: async () => {
        currentWorkspaceRepoPathRef.current = "/tmp/other";
      },
    });

    await expect(prepareSend(buildWorkflowSession({ status: "idle" }))).rejects.toThrow(
      "Workspace changed while preparing session send.",
    );
    expect(
      hasSessionObserverFixture(sessionObserversRef.current, {
        externalSessionId: "session-1",
      }),
    ).toBe(false);
  });
});
