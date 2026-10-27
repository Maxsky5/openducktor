import { repoConfigSchema, type StartupOperationSnapshot } from "@openducktor/contracts";
import { createElement, type PropsWithChildren } from "react";
import type { HostClient } from "@openducktor/host-client";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { createStartupLiveSourceFake } from "@openducktor/frontend-core/test-support/startup-live-source-fake";
import { createWorkflowLaunchClient } from "@/test-utils/workflow-launch-client";
import { sonnerFeedback } from "@/lib/sonner-feedback";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";

export type AgentStudioWorkflowFixture = Parameters<typeof createWorkflowLaunchClient>[0];

/** Supplies host facts while the real shared runner owns readiness and navigation. */
export function createAgentStudioStartupTestHost(
  workflow: () => AgentStudioWorkflowFixture,
  holdPreparedPublication = false,
  client: Partial<HostClient> = {},
) {
  const connection = createTestClientConnection({
    feedback: sonnerFeedback,
    scheduleTask: () => () => {},
    client: {
      taskWorktreeGet: async () => ({
        workingDirectory: "/repo/worktrees/task-1",
        source: "builder_session",
      }),
      workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      workspaceGetRepoConfig: async () =>
        repoConfigSchema.parse({
          workspaceId: "workspace-1",
          workspaceName: "Repo",
          repoPath: "/repo",
          branchPrefix: "odt",
          defaultTargetBranch: { remote: "origin", branch: "main" },
        }),
      ...client,
      agentSessionWorkflowLaunch: async (request) => {
        if (!request.startup) throw new Error("The shared runner must track the launch.");
        const result =
          await createWorkflowLaunchClient(workflow()).agentSessionWorkflowLaunch(request);
        const session = result.session;
        const operation = {
          context: request.startup,
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          scope: { kind: "task" as const, taskId: request.taskId, role: result.role },
        };
        const startupProgress: StartupOperationSnapshot = session
          ? live.prepared({
              ...operation,
              ownership: {
                state: "saved",
                target: {
                  kind: "task",
                  runtimeSession: session,
                  record: {
                    externalSessionId: session.externalSessionId,
                    runtimeKind: session.runtimeKind,
                    workingDirectory: session.workingDirectory,
                    role: result.role,
                    startedAt: session.startedAt,
                    selectedModel: result.model ?? null,
                  },
                },
              },
            })
          : {
              ...operation,
              hostInstanceId: "host",
              revision: 1,
              phase: "failed",
              ownership: { state: "not_saved" },
              steps: [],
            };
        startupProgress.phase = result.status === "completed" ? "completed" : "failed";
        startupProgress.steps = [
          {
            id: result.unsentInstruction ? "instruction" : "prepare",
            label: "Prepare session",
            state: result.status === "completed" ? "completed" : "failed",
            details: [],
            ...(result.failure && {
              failure: {
                stage: "prepare",
                code: "startup_failed",
                message: result.failure.message,
                nextAction: "Inspect the saved session.",
              },
            }),
          },
        ];
        if (request.instruction.kind !== "none")
          startupProgress.instruction = {
            state: result.acceptedMessage ? "accepted" : "not_sent",
          };
        return { ...result, startupProgress };
      },
    },
  });
  const live = createStartupLiveSourceFake(connection.queryClient, {
    holdPreparedPublication,
  });
  const sessions = createAgentSessionsStore("/repo");
  const operations = createAgentOperationsFixture({
    sendAgentMessage: async (session, parts, options) =>
      (await workflow().sendAgentMessage?.(session, parts, options)) ?? null,
  });
  const Providers = ({ children }: PropsWithChildren) =>
    createElement(
      AgentSessionsContext,
      { value: sessions },
      createElement(AgentOperationsContext, { value: operations }, children),
    );
  return {
    connection,
    Providers,
    publishPrepared: live.publishPrepared,
    dispose: async () => {
      live.dispose();
      await connection.dispose();
    },
  };
}
