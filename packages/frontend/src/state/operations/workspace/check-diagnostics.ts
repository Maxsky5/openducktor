import type { RuntimeCheck, RuntimeDescriptor, TaskStoreCheck } from "@openducktor/contracts";
import { isRepoStoreReady } from "@/lib/repo-store-health";
import type { DiagnosticsFailureKind, ObservedCheck } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";

type NonNullDiagnosticsFailureKind = Exclude<DiagnosticsFailureKind, null>;
type DiagnosticsToastSeverity = Exclude<DiagnosticsFailureKind, "timeout" | null>;
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
  failureKind: NonNullDiagnosticsFailureKind;
};

type BuildDiagnosticsToastIssuesArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeCheck: ObservedCheck<RuntimeCheck>;
  taskStoreCheck: ObservedCheck<TaskStoreCheck>;
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
  pathOk: false,
  gitOk: false,
  gitVersion: null,
  runtimes: runtimeDefinitions.map((definition) => ({
    kind: definition.kind,
    enabled: true,
    ok: false,
    executablePath: null,
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
  return runtimeCheck !== null && (!runtimeCheck.pathOk || !runtimeCheck.gitOk);
};

export const hasTaskStoreCheckFailure = (taskStoreCheck: TaskStoreCheck | null): boolean => {
  return taskStoreCheck !== null && !isRepoStoreReady(taskStoreCheck);
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
  failureKind: DiagnosticsFailureKind,
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
  if (!runtimeCheck.pathOk) {
    return runtimeCheck.errors[0] ?? "The user PATH is unavailable.";
  }
  if (!runtimeCheck.gitOk) {
    return runtimeCheck.errors[0] ?? "Git is unavailable.";
  }
  return null;
};

const getRuntimeCheckIssueCandidate = ({
  data,
  error,
  failureKind: readFailureKind,
}: ObservedCheck<RuntimeCheck>): DiagnosticsIssueCandidate | null => {
  const detail = getCliToolsCheckFailureDetail(data, error);
  const failureKind = readFailureKind ?? (hasCliToolCheckFailure(data) ? "error" : null);
  return buildDiagnosticsIssueCandidate(CLI_TOOLS_ISSUE_META, detail, failureKind);
};

const getTaskStoreCheckIssueCandidate = ({
  data,
  error,
  failureKind: readFailureKind,
}: ObservedCheck<TaskStoreCheck>): DiagnosticsIssueCandidate | null => {
  const detail = hasTaskStoreCheckFailure(data)
    ? (data?.repoStoreHealth?.detail ?? error ?? data?.taskStoreError ?? null)
    : (error ?? data?.repoStoreHealth?.detail ?? data?.taskStoreError ?? null);
  const failureKind = readFailureKind ?? (hasTaskStoreCheckFailure(data) ? "error" : null);
  return buildDiagnosticsIssueCandidate(TASK_STORE_ISSUE_META, detail, failureKind);
};

export const buildDiagnosticsToastIssues = ({
  activeWorkspace,
  runtimeCheck,
  taskStoreCheck,
}: BuildDiagnosticsToastIssuesArgs): DiagnosticsToastIssue[] => {
  if (activeWorkspace === null) {
    return [];
  }

  return [
    getRuntimeCheckIssueCandidate(runtimeCheck),
    getTaskStoreCheckIssueCandidate(taskStoreCheck),
  ].reduce<DiagnosticsToastIssue[]>((issues, issueCandidate) => {
    if (issueCandidate !== null && issueCandidate.failureKind === "error") {
      issues.push(buildDiagnosticsToastIssue(issueCandidate));
    }
    return issues;
  }, []);
};
