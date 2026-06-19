import type { RuntimeCheck, RuntimeDescriptor, TaskStoreCheck } from "@openducktor/contracts";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import { classifyRepoRuntimeHealth } from "@/lib/repo-runtime-health";
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

export const hasCliToolCheckFailure = (runtimeCheck: RuntimeCheck | null): boolean => {
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

export const getCliToolsCheckFailureDetail = (
  runtimeCheck: RuntimeCheck | null,
  runtimeCheckError: string | null,
): string | null => {
  if (runtimeCheckError) {
    return runtimeCheckError;
  }
  if (!runtimeCheck) {
    return null;
  }
  if (!runtimeCheck.gitOk) {
    return runtimeCheck.errors[0] ?? "Git is unavailable.";
  }
  if (!runtimeCheck.ghOk) {
    return runtimeCheck.ghAuthError ?? runtimeCheck.errors[0] ?? "GitHub CLI is unavailable.";
  }
  if (!runtimeCheck.ghAuthOk) {
    return runtimeCheck.ghAuthError ?? "GitHub CLI authentication is unavailable.";
  }
  return null;
};

const getRuntimeCheckIssueCandidate = (
  runtimeCheck: RuntimeCheck | null,
  runtimeCheckError: string | null,
  runtimeCheckFailureKind: RepoRuntimeFailureKind,
): DiagnosticsIssueCandidate | null => {
  const detail = getCliToolsCheckFailureDetail(runtimeCheck, runtimeCheckError);
  const failureKind =
    runtimeCheckFailureKind ?? (hasCliToolCheckFailure(runtimeCheck) ? "error" : null);
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

    const runtimeIssue =
      classifyRepoRuntimeHealth(runtimeHealth) === "blocked"
        ? buildDiagnosticsIssueCandidate(
            {
              id: `diagnostics:runtime:${definition.kind}`,
              label: `${definition.label} runtime`,
              availabilityVerb: "is",
            },
            runtimeHealth.runtime.detail,
            runtimeHealth.runtime.status === "error" ? "error" : runtimeHealth.runtime.failureKind,
          )
        : null;

    if (runtimeIssue !== null) {
      issueCandidates.push(runtimeIssue);
      continue;
    }

    if (
      runtimeHealth.runtime.status !== "ready" ||
      !definition.capabilities.optionalSurfaces.supportsMcpStatus
    ) {
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
