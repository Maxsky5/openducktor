import { Effect } from "effect";
import { createTerminalService } from "../../application/terminals/terminal-service";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import type { WorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import type { TaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";

export const createNodeTerminalService = ({
  ports,
  admission,
  taskWorktrees,
  settings,
  sessions,
}: {
  ports: Pick<NodeHostDefaultPorts, "filesystem" | "git" | "terminalPty" | "readEnv">;
  admission: WorkspaceAdmissionService;
  taskWorktrees: TaskWorktreeService;
  settings: WorkspaceSettingsService;
  sessions: WorkspaceSessionStorePort;
}) =>
  Effect.runSync(
    createTerminalService({
      withProcessStartAdmission: admission.withProcessStartAdmission,
      filesystem: ports.filesystem,
      git: ports.git,
      taskWorktrees,
      workspaceSessions: { settings, store: sessions },
      ptyPort: ports.terminalPty,
      launchEnvironment: createTerminalLaunchEnvironment({ readEnv: ports.readEnv }),
    }),
  );
