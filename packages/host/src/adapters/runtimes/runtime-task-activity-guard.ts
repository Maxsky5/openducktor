import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeRoute,
} from "@openducktor/contracts";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskActivityGuardPort } from "../../ports/task-activity-guard-port";

export type CreateRuntimeTaskActivityGuardInput = {
  runtimeRegistry: RuntimeRegistryPort;
};

type ActiveWorkEvidence = {
  activeSessionRoles: string[];
};

type RuntimeRouteIndex = Map<string, RuntimeRoute>;

const normalizePathForComparison = (path: string): string => {
  const components: string[] = [];
  for (const component of path.trim().split(/[\\/]+/)) {
    if (!component || component === ".") {
      continue;
    }
    if (component === "..") {
      components.pop();
      continue;
    }
    components.push(component);
  }

  return path.startsWith("/") ? `/${components.join("/")}` : components.join("/");
};

const routeIndexKey = (runtimeKind: string): string => runtimeKind.trim();

const collectRuntimeRoutes = async (
  runtimeRegistry: RuntimeRegistryPort,
  repoPath: string,
): Promise<RuntimeRouteIndex> => {
  const normalizedRepoPath = normalizePathForComparison(repoPath);
  const routesByKind = new Map<string, RuntimeRoute>();

  for (const runtime of await runtimeRegistry.listRuntimes()) {
    if (!isWorkspaceRepoRuntime(runtime, normalizedRepoPath)) {
      continue;
    }

    const key = routeIndexKey(runtime.kind);
    if (routesByKind.has(key)) {
      throw new Error(
        `Multiple live ${runtime.kind} repo runtimes found for repo '${repoPath}'; cannot resolve session probe route`,
      );
    }
    routesByKind.set(key, runtime.runtimeRoute);
  }

  return routesByKind;
};

const isWorkspaceRepoRuntime = (
  runtime: RuntimeInstanceSummary,
  normalizedRepoPath: string,
): boolean =>
  normalizePathForComparison(runtime.repoPath) === normalizedRepoPath &&
  runtime.role === "workspace" &&
  runtime.taskId === null;

const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

const collectActiveWorkEvidence = async (
  runtimeRegistry: RuntimeRegistryPort,
  repoPath: string,
  sessions: AgentSessionRecord[],
  sessionRoles: string[],
): Promise<ActiveWorkEvidence> => {
  const allowedRoles = new Set(sessionRoles.map((role) => role.trim()).filter(Boolean));
  const runtimeRoutes = await collectRuntimeRoutes(runtimeRegistry, repoPath);
  const activeRoles: string[] = [];

  for (const session of sessions) {
    const role = session.role.trim();
    if (!allowedRoles.has(role)) {
      continue;
    }

    const externalSessionId = session.externalSessionId.trim();
    if (!externalSessionId) {
      continue;
    }

    const runtimeKind = session.runtimeKind.trim();
    const runtimeRoute = runtimeRoutes.get(routeIndexKey(runtimeKind));
    if (!runtimeRoute) {
      continue;
    }

    if (!runtimeRegistry.probeSessionStatus) {
      activeRoles.push(role);
      continue;
    }

    const probe = await runtimeRegistry.probeSessionStatus({
      runtimeKind,
      runtimeRoute,
      externalSessionId,
      workingDirectory: session.workingDirectory,
    });
    if (!probe.supported || probe.hasLiveSession) {
      activeRoles.push(role);
    }
  }

  return {
    activeSessionRoles: uniqueSorted(activeRoles),
  };
};

const deleteBlockerSummary = (activeSessionRoles: string[]): string =>
  activeSessionRoles.map((role) => `${role} session`).join(", ");

export const createRuntimeTaskActivityGuard = ({
  runtimeRegistry,
}: CreateRuntimeTaskActivityGuardInput): TaskActivityGuardPort => ({
  async ensureNoActiveTaskDeleteRuns(input) {
    const activeTasks: Array<{ taskId: string; evidence: ActiveWorkEvidence }> = [];
    for (const taskId of input.taskIds) {
      const task = input.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error(`Task ${taskId} was not provided for activity guard checks.`);
      }

      const evidence = await collectActiveWorkEvidence(
        runtimeRegistry,
        input.repoPath,
        task.agentSessions ?? [],
        ["build", "qa"],
      ).catch((error: unknown) => {
        throw new Error(`Failed checking active task work before deleting ${taskId}`, {
          cause: error,
        });
      });
      if (evidence.activeSessionRoles.length > 0) {
        activeTasks.push({ taskId, evidence });
      }
    }

    if (activeTasks.length === 0) {
      return;
    }

    activeTasks.sort((left, right) => left.taskId.localeCompare(right.taskId));
    const qaOnly = activeTasks.every((entry) =>
      entry.evidence.activeSessionRoles.every((role) => role === "qa"),
    );
    const activeSummary = activeTasks
      .map(
        ({ taskId, evidence }) =>
          `${taskId} (${deleteBlockerSummary(evidence.activeSessionRoles)})`,
      )
      .join(", ");
    if (qaOnly) {
      throw new Error(
        `Cannot delete tasks with active QA work in progress. Stop the active QA session(s) first: ${activeSummary}`,
      );
    }

    throw new Error(
      `Cannot delete tasks with active builder work in progress. Stop the active session(s) first: ${activeSummary}`,
    );
  },

  async ensureNoActiveTaskResetActivity(input) {
    const evidence = await collectActiveWorkEvidence(
      runtimeRegistry,
      input.repoPath,
      input.sessions,
      input.sessionRoles,
    ).catch((error: unknown) => {
      throw new Error(
        `Failed checking live runtime state before ${input.operationLabel} ${input.taskId}`,
        { cause: error },
      );
    });

    if (evidence.activeSessionRoles.length === 0) {
      return;
    }

    throw new Error(
      `Cannot ${input.operationLabel} while active ${evidence.activeSessionRoles.join("/")} session(s) exist for task ${input.taskId}. Stop the active session(s) first.`,
    );
  },
});
