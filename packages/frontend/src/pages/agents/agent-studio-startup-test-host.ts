import {
  repoConfigSchema,
  type AgentSessionLiveEnvelope,
  type StartupOperationSnapshot,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren } from "react";
import type { HostClient } from "@openducktor/host-client";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { registerStartupLiveSource } from "@openducktor/frontend-core/sessions/startup/startup-prepared-handoff";
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
  const listeners = new Set<(event: AgentSessionLiveEnvelope) => void>();
  let sequence = 0;
  const preparedEvents: AgentSessionLiveEnvelope[] = [];
  const publishPrepared = () => {
    for (const event of preparedEvents.splice(0)) for (const listener of listeners) listener(event);
  };
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
        const ref = session
          ? {
              repoPath: request.repoPath,
              runtimeKind: session.runtimeKind,
              workingDirectory: session.workingDirectory,
              externalSessionId: session.externalSessionId,
            }
          : null;
        if (session && ref) {
          sequence += 1;
          const envelope: AgentSessionLiveEnvelope = {
            type: "session_upsert",
            sequence,
            session: {
              ref,
              activity: "idle",
              title: "Started session",
              startedAt: session.startedAt,
              pendingApprovals: [],
              pendingQuestions: [],
              contextUsage: null,
            },
          };
          preparedEvents.push(envelope);
          if (!holdPreparedPublication) publishPrepared();
        }
        const startupProgress: StartupOperationSnapshot = {
          context: request.startup,
          hostInstanceId: "host",
          revision: 1,
          workspaceId: request.workspaceId,
          repoPath: request.repoPath,
          scope: { kind: "task", taskId: request.taskId, role: result.role },
          phase: result.status === "completed" ? "completed" : "failed",
          ownership: session
            ? {
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
              }
            : { state: "not_saved" },
          steps: [
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
          ],
          ...(ref && { prepared: { ref, runtimeId: "runtime", liveStateSequence: sequence } }),
          ...(request.instruction.kind !== "none" && {
            instruction: {
              state: result.acceptedMessage ? "accepted" : "not_sent",
            },
          }),
        };
        return { ...result, startupProgress };
      },
    },
  });
  const releaseLiveSource = registerStartupLiveSource(connection.queryClient, {
    observeWorkspace: () => () => {},
    observeAgentSessionLive: async ({ repoPath }, listener) => {
      listeners.add(listener);
      listener({ type: "snapshot", repoPath, sequence, sessions: [], messageQueues: [] });
      return () => {
        listeners.delete(listener);
      };
    },
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
    publishPrepared,
    dispose: async () => {
      releaseLiveSource();
      await connection.dispose();
    },
  };
}
