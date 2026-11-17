import { Effect } from "effect";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import {
  type AutopilotService,
  type AutopilotServiceDependencies,
  createAutopilotService,
} from "../../application/autopilot/autopilot-service";
import {
  createUsageLimitAutoResumeService,
  type UsageLimitAutoResumeService,
  type UsageLimitAutoResumeServiceDependencies,
} from "../../application/agent-sessions/usage-limit-auto-resume-service";
import type { GitPort } from "../../ports/git-port";
import type { createNodeTaskSessionServices } from "./node-task-session-services";
import type { HostLifecycleLogger } from "../host-lifecycle";
import { createLiveSessionFaultLogger } from "./node-host-lifecycle-logger";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { CommittedTaskStatusChange } from "../../application/tasks/task-mutation-operation";
import type { SettingsConfigView } from "../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { createAutopilotCommandHandlers } from "../../interface/commands/autopilot-command-handlers";
import { createUsageLimitAutoResumeCommandHandlers } from "../../interface/commands/agent-session-live-command-handlers";

type Shared = "settingsConfig" | "onBackgroundFailure";
type TaskSessions = Pick<
  ReturnType<typeof createNodeTaskSessionServices>,
  "taskService" | "taskSyncService" | "workflowLaunchService" | "agentSessionCommandService"
>;

/**
 * Composes the host services that act without a client: Autopilot and the auto-resume after a
 * usage limit. Settings, task, and live hooks exist before the services, so they bind late.
 */
export const createNodeSessionAutomation = (
  onBackgroundFailure: AutopilotServiceDependencies["onBackgroundFailure"],
  lifecycleLogger: HostLifecycleLogger,
  git: Pick<GitPort, "canonicalizePath">,
) => {
  let autopilot: AutopilotService | undefined;
  let autoResume: UsageLimitAutoResumeService | undefined;
  return {
    configCommitted: (config: SettingsConfigView): Effect.Effect<void> =>
      (autopilot ? autopilot.configCommitted(config) : Effect.void).pipe(
        Effect.andThen(autoResume ? autoResume.configCommitted(config) : Effect.void),
      ),
    observeStatusChanges: (change: CommittedTaskStatusChange) => autopilot?.observe(change),
    observeLive: (envelope: AgentSessionLiveEnvelope) => autoResume?.observe(envelope),
    runtimeRegistered: (adapter: Parameters<UsageLimitAutoResumeService["runtimeRegistered"]>[0]) =>
      autoResume?.runtimeRegistered(adapter),
    create: (input: {
      autopilot: Omit<
        AutopilotServiceDependencies,
        Shared | "tasks" | "mutations" | "workflowLaunch"
      >;
      autoResume: Omit<
        UsageLimitAutoResumeServiceDependencies,
        Shared | "resume" | "listRepoPaths" | "readUsageLimitRecovery" | "logReadFailure"
      > & {
        settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
        adapters: Pick<AgentSessionLiveAdapterRegistryPort, "resolveForScope">;
      };
      taskSessions: TaskSessions;
      settingsConfig: AutopilotServiceDependencies["settingsConfig"];
    }) => {
      const { settings, adapters, ...autoResumeDependencies } = input.autoResume;
      const shared = { settingsConfig: input.settingsConfig, onBackgroundFailure };
      const { taskService, taskSyncService, workflowLaunchService } = input.taskSessions;
      autopilot = createAutopilotService({
        ...input.autopilot,
        ...shared,
        tasks: taskService,
        mutations: taskSyncService,
        workflowLaunch: workflowLaunchService,
      });
      autoResume = createUsageLimitAutoResumeService({
        ...autoResumeDependencies,
        ...shared,
        resume: input.taskSessions.agentSessionCommandService.resumeSession,
        logReadFailure: createLiveSessionFaultLogger(lifecycleLogger),
        readUsageLimitRecovery: (ref) =>
          adapters
            .resolveForScope(ref)
            .pipe(Effect.flatMap((adapter) => adapter.queries.readUsageLimitRecovery(ref))),
        listRepoPaths: () =>
          settings
            .getWorkspaceCatalog()
            .pipe(
              Effect.map((catalog) => [
                ...new Set(catalog.openWorkspaces.map((workspace) => workspace.repoPath)),
              ]),
            ),
      });
      return {
        /** The lifecycle starts and stops both services. */
        lifecycle: { autopilot, autoResume },
        handlers: {
          ...createAutopilotCommandHandlers(autopilot),
          ...createUsageLimitAutoResumeCommandHandlers(autoResume, (repoPath) =>
            git.canonicalizePath(repoPath),
          ),
        },
      };
    },
  };
};
