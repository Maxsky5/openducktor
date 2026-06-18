import type { RuntimeCheck, RuntimeDescriptor, TaskStoreCheck } from "@openducktor/contracts";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import { isRepoStoreReady } from "@/lib/repo-store-health";
import type {
  RepoRuntimeFailureKind,
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMap,
} from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";

type NonNullRepoRuntimeFailureKind = Exclude<RepoRuntimeFailureKind, null>;
type DiagnosticsToastSeverity = Exclude<RepoRuntimeFailureKind, "timeout" | null>;
type AvailabilityVerb = "is" | "are";

export type DiagnosticsToastIssue = {
  id: string;
  title: string;
  description: string;
  severity: DiagnosticsToastSeverity;
};

export type DiagnosticsRetryPlan = {
  retryRuntimeCheck: boolean;
  retryTaskStoreCheck: boolean;
  retryRuntimeHealth: boolean;
};

type DiagnosticsIssueMeta = {
  id: string;
  label: string;
  availabilityVerb: AvailabilityVerb;
};

type DiagnosticsIssueCandidate = DiagnosticsIssueMeta & {
  detail: string | null;
  failureKind: NonNullRepoRuntimeFailureKind;
};

type BuildDiagnosticsToastIssuesArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheck: RuntimeCheck | null;
  runtimeCheckError: string | null;
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  taskStoreCheck: TaskStoreCheck | null;
  taskStoreCheckError: string | null;
  taskStoreCheckFailureKind: RepoRuntimeFailureKind;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
};

type BuildDiagnosticsRetryPlanArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  runtimeCheckFetching: boolean;
  taskStoreCheckFailureKind: RepoRuntimeFailureKind;
  taskStoreCheckFetching: boolean;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  runtimeHealthFetching: boolean;
};

const CLI_TOOLS_ISSUE_META: DiagnosticsIssueMeta = {
  id: "diagnostics:cli-tools",
  label: "CLI tools",
  availabilityVerb: "are",
};

const TASK_STORE_ISSUE_META: DiagnosticsIssueMeta = {
  id: "diagnostics:task-store",
  label: "Task store",
  availabilityVerb: "is",
};

export const buildRuntimeCheckErrorState = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeCheckError: string,
): RuntimeCheck => ({
  gitOk: false,
  gitVersion: null,
  ghOk: false,
  ghVersion: null,
  ghAuthOk: false,
  ghAuthLogin: null,
  ghAuthError: runtimeCheckError,
  runtimes: runtimeDefinitions.map((definition) => ({
    kind: definition.kind,
    enabled: true,
    ok: false,
    version: null,
  })),
  errors: [runtimeCheckError],
});

export const buildTaskStoreCheckErrorState = (taskStoreCheckError: string): TaskStoreCheck => ({
  repoStoreHealth: {
    category: "check_call_failed",
    status: "degraded",
    isReady: false,
    detail: taskStoreCheckError,
    databasePath: null,
  },
  taskStoreOk: false,
  taskStorePath: null,
  taskStoreError: taskStoreCheckError,
});

export const hasRuntimeCheckFailure = (runtimeCheck: RuntimeCheck | null): boolean => {
  return (
    runtimeCheck !== null && (!runtimeCheck.gitOk || !runtimeCheck.ghOk || !runtimeCheck.ghAuthOk)
  );
};

export const hasTaskStoreCheckFailure = (taskStoreCheck: TaskStoreCheck | null): boolean => {
  return taskStoreCheck !== null && !isRepoStoreReady(taskStoreCheck);
};

export const buildRuntimeHealthErrorMap = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthError: string,
  checkedAt: string,
): RepoRuntimeHealthMap => {
  return runtimeDefinitions.reduce<RepoRuntimeHealthMap>((runtimeHealthMap, definition) => {
    runtimeHealthMap[definition.kind] = {
      status: "error",
      checkedAt,
      runtime: {
        status: "error",
        stage: "startup_failed",
        observation: null,
        instance: null,
        startedAt: null,
        updatedAt: checkedAt,
        elapsedMs: null,
        attempts: null,
        detail: runtimeHealthError,
        failureKind: "error",
        failureReason: null,
      },
      mcp: {
        supported: true,
        status: "error",
        serverName: ODT_MCP_SERVER_NAME,
        serverStatus: null,
        toolIds: [],
        detail: runtimeHealthError,
        failureKind: "error",
      },
    } satisfies RepoRuntimeHealthCheck;
    return runtimeHealthMap;
  }, {});
};

type TimeoutMessageOptions = {
  availabilityVerb?: AvailabilityVerb;
};

export const buildTimeoutToastDescription = (
  label: string,
  detail: string | null,
  options?: TimeoutMessageOptions,
): string => {
  const availabilityVerb = options?.availabilityVerb ?? "is";

  if (!detail) {
    return `${label} ${availabilityVerb} not yet available. Retrying automatically.`;
  }

  return `${label} ${availabilityVerb} not yet available. Retrying automatically. Latest detail: ${detail}`;
};

const buildErrorToastDescription = (label: string, detail: string | null): string => {
  return detail ?? `${label} is unavailable.`;
};

const buildDiagnosticsToastIssue = ({
  id,
  label,
  detail,
}: DiagnosticsIssueCandidate): DiagnosticsToastIssue => {
  return {
    id,
    title: `${label} unavailable`,
    description: buildErrorToastDescription(label, detail),
    severity: "error",
  };
};

const buildDiagnosticsIssueCandidate = (
  meta: DiagnosticsIssueMeta,
  detail: string | null,
  failureKind: RepoRuntimeFailureKind,
): DiagnosticsIssueCandidate | null => {
  if (detail === null || failureKind === null) {
    return null;
  }

  return {
    ...meta,
    detail,
    failureKind,
  };
};

const getRuntimeCheckIssueCandidate = (
  runtimeCheck: RuntimeCheck | null,
  runtimeCheckError: string | null,
  runtimeCheckFailureKind: RepoRuntimeFailureKind,
): DiagnosticsIssueCandidate | null => {
  const detail = runtimeCheckError ?? runtimeCheck?.errors[0] ?? runtimeCheck?.ghAuthError ?? null;
  const failureKind =
    runtimeCheckFailureKind ?? (hasRuntimeCheckFailure(runtimeCheck) ? "error" : null);
  return buildDiagnosticsIssueCandidate(CLI_TOOLS_ISSUE_META, detail, failureKind);
};

const getTaskStoreCheckIssueCandidate = (
  taskStoreCheck: TaskStoreCheck | null,
  taskStoreCheckError: string | null,
  taskStoreCheckFailureKind: RepoRuntimeFailureKind,
): DiagnosticsIssueCandidate | null => {
  const detail = hasTaskStoreCheckFailure(taskStoreCheck)
    ? (taskStoreCheck?.repoStoreHealth?.detail ??
      taskStoreCheckError ??
      taskStoreCheck?.taskStoreError ??
      null)
    : (taskStoreCheckError ??
      taskStoreCheck?.repoStoreHealth?.detail ??
      taskStoreCheck?.taskStoreError ??
      null);
  const failureKind =
    taskStoreCheckFailureKind ?? (hasTaskStoreCheckFailure(taskStoreCheck) ? "error" : null);
  return buildDiagnosticsIssueCandidate(TASK_STORE_ISSUE_META, detail, failureKind);
};

const getRuntimeHealthIssueCandidates = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthByRuntime: RepoRuntimeHealthMap,
): DiagnosticsIssueCandidate[] => {
  const issueCandidates: DiagnosticsIssueCandidate[] = [];

  for (const definition of runtimeDefinitions) {
    const runtimeHealth = runtimeHealthByRuntime[definition.kind];
    if (!runtimeHealth) {
      continue;
    }

    const runtimeIssue = buildDiagnosticsIssueCandidate(
      {
        id: `diagnostics:runtime:${definition.kind}`,
        label: `${definition.label} runtime`,
        availabilityVerb: "is",
      },
      runtimeHealth.runtime.detail,
      runtimeHealth.runtime.status === "error" ? "error" : runtimeHealth.runtime.failureKind,
    );

    if (runtimeIssue !== null) {
      issueCandidates.push(runtimeIssue);
      continue;
    }

    if (!definition.capabilities.optionalSurfaces.supportsMcpStatus) {
      continue;
    }

    const mcpIssue = buildDiagnosticsIssueCandidate(
      {
        id: `diagnostics:mcp:${definition.kind}`,
        label: `${definition.label} OpenDucktor MCP`,
        availabilityVerb: "is",
      },
      runtimeHealth.mcp?.detail ?? null,
      runtimeHealth.mcp?.status === "error" ? "error" : (runtimeHealth.mcp?.failureKind ?? null),
    );

    if (mcpIssue !== null) {
      issueCandidates.push(mcpIssue);
    }
  }

  return issueCandidates;
};

export const buildDiagnosticsToastIssues = ({
  activeWorkspace,
  runtimeDefinitions,
  runtimeCheck,
  runtimeCheckError,
  runtimeCheckFailureKind,
  taskStoreCheck,
  taskStoreCheckError,
  taskStoreCheckFailureKind,
  runtimeHealthByRuntime,
}: BuildDiagnosticsToastIssuesArgs): DiagnosticsToastIssue[] => {
  if (activeWorkspace === null) {
    return [];
  }

  return [
    getRuntimeCheckIssueCandidate(runtimeCheck, runtimeCheckError, runtimeCheckFailureKind),
    getTaskStoreCheckIssueCandidate(taskStoreCheck, taskStoreCheckError, taskStoreCheckFailureKind),
    ...getRuntimeHealthIssueCandidates(runtimeDefinitions, runtimeHealthByRuntime),
  ].reduce<DiagnosticsToastIssue[]>((issues, issueCandidate) => {
    if (issueCandidate !== null && issueCandidate.failureKind === "error") {
      issues.push(buildDiagnosticsToastIssue(issueCandidate));
    }
    return issues;
  }, []);
};

const hasRuntimeHealthTimeoutIssue = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthByRuntime: RepoRuntimeHealthMap,
): boolean => {
  return runtimeDefinitions.some((definition) => {
    const runtimeHealth = runtimeHealthByRuntime[definition.kind];
    if (!runtimeHealth) {
      return false;
    }

    return (
      (runtimeHealth.runtime.status !== "error" &&
        runtimeHealth.runtime.failureKind === "timeout") ||
      (definition.capabilities.optionalSurfaces.supportsMcpStatus &&
        runtimeHealth.mcp?.status !== "error" &&
        runtimeHealth.mcp?.failureKind === "timeout")
    );
  });
};

export const hasDiagnosticsRetryingState = ({
  runtimeDefinitions,
  runtimeCheckFailureKind,
  taskStoreCheckFailureKind,
  runtimeHealthByRuntime,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  taskStoreCheckFailureKind: RepoRuntimeFailureKind;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
}): boolean => {
  return (
    runtimeCheckFailureKind === "timeout" ||
    taskStoreCheckFailureKind === "timeout" ||
    hasRuntimeHealthTimeoutIssue(runtimeDefinitions, runtimeHealthByRuntime)
  );
};

export const buildDiagnosticsRetryPlan = ({
  activeWorkspace,
  runtimeDefinitions,
  runtimeCheckFailureKind,
  runtimeCheckFetching,
  taskStoreCheckFailureKind,
  taskStoreCheckFetching,
  runtimeHealthByRuntime,
  runtimeHealthFetching,
}: BuildDiagnosticsRetryPlanArgs): DiagnosticsRetryPlan => {
  const retryRuntimeCheck = runtimeCheckFailureKind === "timeout" && !runtimeCheckFetching;
  const retryTaskStoreCheck =
    activeWorkspace !== null && taskStoreCheckFailureKind === "timeout" && !taskStoreCheckFetching;
  const retryRuntimeHealth =
    activeWorkspace !== null &&
    runtimeDefinitions.length > 0 &&
    hasRuntimeHealthTimeoutIssue(runtimeDefinitions, runtimeHealthByRuntime) &&
    !runtimeHealthFetching;

  return {
    retryRuntimeCheck,
    retryTaskStoreCheck,
    retryRuntimeHealth,
  };
};
