import {
  startupOperationContextSchema,
  agentSessionControlSummarySchema,
  agentRoleSchema,
  workflowLaunchRequestSchema,
  type StartupScope,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  createStartupProgressRecorder,
  CurrentStartupProgress,
  rememberStartupFailure,
  finalizeStartup,
} from "../../application/agent-sessions/session-startup-progress";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import type { HostEventBusPort } from "../../events/host-event-bus";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { z } from "zod";
import type { HostCommandArgs } from "../../interface/commands/command-inputs";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { requireLaunchAction } from "../../application/agent-sessions/workflow-launch-preparation";

export const createNodeSessionStartupTracker =
  (dependencies: {
    hostInstanceId: string;
    eventBus: HostEventBusPort | undefined;
    settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "getRepoConfigByRepoPath">;
    taskWorkflows: TaskWorkflowResolver;
    finalize: AgentSessionLiveStateService["finalizeStartupPreparation"];
    runtime: Pick<RuntimeRegistryPort, "probeSessionStatus">;
  }) =>
  <A, E>(command: string, args: HostCommandArgs, work: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      if (!commands.has(command)) return yield* work;
      const parsed = inputSchema.safeParse(args);
      // The command's own schema reports invalid input without starting a tracker.
      if (!parsed.success) return yield* work;
      const origin = parsed.data;
      if (!origin.workspaceId && !origin.repoPath) return yield* work;
      const config = yield* origin.workspaceId
        ? dependencies.settings.getRepoConfig(origin.workspaceId)
        : dependencies.settings.getRepoConfigByRepoPath(origin.repoPath!);
      let scope: StartupScope = { kind: "workspace" };
      if (origin.sessionId) scope = { kind: "workspace", sessionId: origin.sessionId };
      if (origin.sessionScope?.kind === "workflow")
        scope = {
          kind: "task",
          taskId: origin.sessionScope.taskId,
          role: origin.sessionScope.role,
        };
      if (origin.taskId && origin.policy) {
        const action = yield* requireLaunchAction(
          dependencies.taskWorkflows.forTask({ id: origin.taskId }),
          { policy: origin.policy },
        );
        scope = {
          kind: "task",
          taskId: origin.taskId,
          role: action.role,
        };
      }
      const progress = createStartupProgressRecorder(
        {
          context: origin.startup,
          hostInstanceId: dependencies.hostInstanceId,
          workspaceId: config.workspaceId,
          repoPath: config.repoPath,
          scope,
        },
        (payload) =>
          dependencies.eventBus?.publish({
            channel: "openducktor://session-startup-progress",
            payload,
          }),
        dependencies.finalize,
        (ref) =>
          dependencies.runtime.probeSessionStatus(ref).pipe(
            Effect.flatMap((status) =>
              status.supported && !status.hasLiveSession
                ? Effect.void
                : Effect.fail(
                    new HostOperationError({
                      operation: "session-startup.confirm-stop",
                      message: `The runtime did not confirm that session ${ref.externalSessionId} stopped. OpenDucktor kept its checkout at ${ref.workingDirectory}. Stop this native session before removing the checkout.`,
                      details: { ref },
                    }),
                  ),
            ),
          ),
      );
      progress.step({ id: "request", label: "Check startup request", state: "running" });
      return yield* work.pipe(
        Effect.provideService(CurrentStartupProgress, progress),
        Effect.tap((result) =>
          Effect.gen(function* () {
            const fields = resultSchema.safeParse(result);
            const status = fields.success ? fields.data.status : undefined;
            if (
              !progress.snapshot().prepared &&
              !["failed", "canceled", "skipped"].includes(status ?? "")
            ) {
              const value = fields.success
                ? (fields.data.runtimeSession ?? fields.data.session ?? result)
                : result;
              const summary = agentSessionControlSummarySchema.safeParse(value);
              if (summary.success)
                yield* finalizeStartup({
                  repoPath: config.repoPath,
                  runtimeKind: summary.data.runtimeKind,
                  workingDirectory: summary.data.workingDirectory,
                  externalSessionId: summary.data.externalSessionId,
                }).pipe(Effect.provideService(CurrentStartupProgress, progress));
            }
            const phase = progress.snapshot().phase;
            if (phase !== "failed" && phase !== "canceled")
              progress.settle(status === "failed" || status === "canceled" ? status : "completed");
            if (fields.success)
              Object.assign(result ?? {}, { startupProgress: progress.snapshot() });
          }),
        ),
        Effect.tapError((failure) =>
          Effect.sync(() => {
            progress.settle("failed", errorMessage(failure));
            rememberStartupFailure(failure, progress.snapshot());
          }),
        ),
      );
    });

const inputSchema = z.object({
  startup: startupOperationContextSchema,
  workspaceId: z.string().optional(),
  repoPath: z.string().optional(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  sessionScope: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("workflow"), taskId: z.string(), role: agentRoleSchema }),
      z.object({ kind: z.literal("repository") }),
    ])
    .optional(),
  policy: workflowLaunchRequestSchema.shape.policy.optional(),
});

const resultSchema = z
  .object({
    status: z.string().optional(),
    runtimeSession: agentSessionControlSummarySchema.nullable().optional(),
    session: z.unknown().optional(),
  })
  .passthrough();

const commands = new Set([
  "agent_session_workflow_launch",
  "agent_session_workflow_start",
  "agent_session_workflow_fork",
  "agent_session_control_start",
  "agent_session_control_resume",
  "agent_session_control_fork",
  "workspace_session_create",
  "workspace_session_start",
  "workspace_session_fork",
]);
