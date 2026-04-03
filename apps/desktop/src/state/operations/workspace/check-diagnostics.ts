import type { BeadsCheck, RuntimeCheck, RuntimeDescriptor } from "@openducktor/contracts";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import type {
  RepoRuntimeFailureKind,
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMap,
} from "@/types/diagnostics";

type NonNullRepoRuntimeFailureKind = Exclude<RepoRuntimeFailureKind, null>;
type AvailabilityVerb = "is" | "are";

export type DiagnosticsToastIssue = {
  id: string;
  title: string;
  description: string;
  severity: NonNullRepoRuntimeFailureKind;
};

export type DiagnosticsRetryPlan = {
  retryRuntimeCheck: boolean;
  retryBeadsCheck: boolean;
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
  activeRepo: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheck: RuntimeCheck | null;
  runtimeCheckError: string | null;
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  beadsCheck: BeadsCheck | null;
  beadsCheckError: string | null;
  beadsCheckFailureKind: RepoRuntimeFailureKind;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
};

type BuildDiagnosticsRetryPlanArgs = {
  activeRepo: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  runtimeCheckFetching: boolean;
  beadsCheckFailureKind: RepoRuntimeFailureKind;
  beadsCheckFetching: boolean;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  runtimeHealthFetching: boolean;
};

const CLI_TOOLS_ISSUE_META: DiagnosticsIssueMeta = {
  id: "diagnostics:cli-tools",
  label: "CLI tools",
  availabilityVerb: "are",
};

const BEADS_STORE_ISSUE_META: DiagnosticsIssueMeta = {
  id: "diagnostics:beads-store",
  label: "Beads store",
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
    ok: false,
    version: null,
  })),
  errors: [runtimeCheckError],
});

export const buildBeadsCheckErrorState = (beadsCheckError: string): BeadsCheck => ({
  beadsOk: false,
  beadsPath: null,
  beadsError: beadsCheckError,
});

export const hasRuntimeCheckFailure = (runtimeCheck: RuntimeCheck | null): boolean => {
  return (
    runtimeCheck !== null &&
    (!runtimeCheck.gitOk ||
      !runtimeCheck.ghOk ||
      !runtimeCheck.ghAuthOk ||
      runtimeCheck.runtimes.some((entry) => !entry.ok))
  );
};

export const hasBeadsCheckFailure = (beadsCheck: BeadsCheck | null): boolean => {
  return beadsCheck?.beadsOk === false;
};

export const buildRuntimeHealthErrorMap = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthError: string,
  checkedAt: string,
): RepoRuntimeHealthMap => {
  return runtimeDefinitions.reduce<RepoRuntimeHealthMap>((runtimeHealthMap, definition) => {
    runtimeHealthMap[definition.kind] = {
      runtimeOk: false,
      runtimeError: runtimeHealthError,
      runtimeFailureKind: "error",
      runtime: null,
      mcpOk: false,
      mcpError: runtimeHealthError,
      mcpFailureKind: "error",
      mcpServerName: ODT_MCP_SERVER_NAME,
      mcpServerStatus: null,
      mcpServerError: runtimeHealthError,
      availableToolIds: [],
      checkedAt,
      errors: [runtimeHealthError],
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
  failureKind,
  availabilityVerb,
}: DiagnosticsIssueCandidate): DiagnosticsToastIssue => {
  return failureKind === "timeout"
    ? {
        id,
        title: `${label} not yet available`,
        description: buildTimeoutToastDescription(label, detail, {
          availabilityVerb,
        }),
        severity: failureKind,
      }
    : {
        id,
        title: `${label} unavailable`,
        description: buildErrorToastDescription(label, detail),
        severity: failureKind,
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

const getBeadsCheckIssueCandidate = (
  beadsCheck: BeadsCheck | null,
  beadsCheckError: string | null,
  beadsCheckFailureKind: RepoRuntimeFailureKind,
): DiagnosticsIssueCandidate | null => {
  const detail = beadsCheckError ?? beadsCheck?.beadsError ?? null;
  const failureKind = beadsCheckFailureKind ?? (hasBeadsCheckFailure(beadsCheck) ? "error" : null);
  return buildDiagnosticsIssueCandidate(BEADS_STORE_ISSUE_META, detail, failureKind);
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
      runtimeHealth.runtimeError,
      runtimeHealth.runtimeOk ? null : runtimeHealth.runtimeFailureKind,
    );

    if (runtimeIssue !== null) {
      issueCandidates.push(runtimeIssue);
      continue;
    }

    if (!definition.capabilities.supportsMcpStatus) {
      continue;
    }

    const mcpIssue = buildDiagnosticsIssueCandidate(
      {
        id: `diagnostics:mcp:${definition.kind}`,
        label: `${definition.label} OpenDucktor MCP`,
        availabilityVerb: "is",
      },
      runtimeHealth.mcpServerError ?? runtimeHealth.mcpError,
      runtimeHealth.mcpOk ? null : runtimeHealth.mcpFailureKind,
    );

    if (mcpIssue !== null) {
      issueCandidates.push(mcpIssue);
    }
  }

  return issueCandidates;
};

export const buildDiagnosticsToastIssues = ({
  activeRepo,
  runtimeDefinitions,
  runtimeCheck,
  runtimeCheckError,
  runtimeCheckFailureKind,
  beadsCheck,
  beadsCheckError,
  beadsCheckFailureKind,
  runtimeHealthByRuntime,
}: BuildDiagnosticsToastIssuesArgs): DiagnosticsToastIssue[] => {
  if (activeRepo === null) {
    return [];
  }

  return [
    getRuntimeCheckIssueCandidate(runtimeCheck, runtimeCheckError, runtimeCheckFailureKind),
    getBeadsCheckIssueCandidate(beadsCheck, beadsCheckError, beadsCheckFailureKind),
    ...getRuntimeHealthIssueCandidates(runtimeDefinitions, runtimeHealthByRuntime),
  ]
    .filter((issueCandidate) => issueCandidate !== null)
    .map((issueCandidate) => buildDiagnosticsToastIssue(issueCandidate));
};

export const hasRuntimeHealthTimeoutIssue = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthByRuntime: RepoRuntimeHealthMap,
): boolean => {
  return runtimeDefinitions.some((definition) => {
    const runtimeHealth = runtimeHealthByRuntime[definition.kind];
    if (!runtimeHealth) {
      return false;
    }

    return (
      runtimeHealth.runtimeFailureKind === "timeout" ||
      (definition.capabilities.supportsMcpStatus && runtimeHealth.mcpFailureKind === "timeout")
    );
  });
};

export const buildDiagnosticsRetryPlan = ({
  activeRepo,
  runtimeDefinitions,
  runtimeCheckFailureKind,
  runtimeCheckFetching,
  beadsCheckFailureKind,
  beadsCheckFetching,
  runtimeHealthByRuntime,
  runtimeHealthFetching,
}: BuildDiagnosticsRetryPlanArgs): DiagnosticsRetryPlan => {
  const retryRuntimeCheck = runtimeCheckFailureKind === "timeout" && !runtimeCheckFetching;
  const retryBeadsCheck =
    activeRepo !== null && beadsCheckFailureKind === "timeout" && !beadsCheckFetching;
  const retryRuntimeHealth =
    activeRepo !== null &&
    runtimeDefinitions.length > 0 &&
    hasRuntimeHealthTimeoutIssue(runtimeDefinitions, runtimeHealthByRuntime) &&
    !runtimeHealthFetching;

  return {
    retryRuntimeCheck,
    retryBeadsCheck,
    retryRuntimeHealth,
  };
};
