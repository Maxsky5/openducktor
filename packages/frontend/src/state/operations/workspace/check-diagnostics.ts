import type { BeadsCheck, RuntimeCheck, RuntimeDescriptor } from "@openducktor/contracts";
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
  activeWorkspace: ActiveWorkspace | null;
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
  activeWorkspace: ActiveWorkspace | null;
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
  repoStoreHealth: {
    category: "check_call_failed",
    status: "degraded",
    isReady: false,
    detail: beadsCheckError,
    attachment: {
      path: null,
      databaseName: null,
    },
    sharedServer: {
      host: null,
      port: null,
      ownershipState: "unavailable",
    },
  },
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
  return (
    beadsCheck !== null &&
    !isRepoStoreReady(beadsCheck) &&
    beadsCheck.repoStoreHealth.status !== "initializing"
  );
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

const getBeadsCheckIssueCandidate = (
  beadsCheck: BeadsCheck | null,
  beadsCheckError: string | null,
  beadsCheckFailureKind: RepoRuntimeFailureKind,
): DiagnosticsIssueCandidate | null => {
  const detail = hasBeadsCheckFailure(beadsCheck)
    ? (beadsCheck?.repoStoreHealth?.detail ?? beadsCheckError ?? beadsCheck?.beadsError ?? null)
    : (beadsCheckError ?? beadsCheck?.repoStoreHealth?.detail ?? beadsCheck?.beadsError ?? null);
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
  beadsCheck,
  beadsCheckError,
  beadsCheckFailureKind,
  runtimeHealthByRuntime,
}: BuildDiagnosticsToastIssuesArgs): DiagnosticsToastIssue[] => {
  if (activeWorkspace === null) {
    return [];
  }

  return [
    getRuntimeCheckIssueCandidate(runtimeCheck, runtimeCheckError, runtimeCheckFailureKind),
    getBeadsCheckIssueCandidate(beadsCheck, beadsCheckError, beadsCheckFailureKind),
    ...getRuntimeHealthIssueCandidates(runtimeDefinitions, runtimeHealthByRuntime),
  ]
    .filter(
      (issueCandidate): issueCandidate is DiagnosticsIssueCandidate =>
        issueCandidate !== null && issueCandidate.failureKind === "error",
    )
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
  beadsCheckFailureKind,
  runtimeHealthByRuntime,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  beadsCheckFailureKind: RepoRuntimeFailureKind;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
}): boolean => {
  return (
    runtimeCheckFailureKind === "timeout" ||
    beadsCheckFailureKind === "timeout" ||
    hasRuntimeHealthTimeoutIssue(runtimeDefinitions, runtimeHealthByRuntime)
  );
};

export const buildDiagnosticsRetryPlan = ({
  activeWorkspace,
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
    activeWorkspace !== null && beadsCheckFailureKind === "timeout" && !beadsCheckFetching;
  const retryRuntimeHealth =
    activeWorkspace !== null &&
    runtimeDefinitions.length > 0 &&
    // Transient startup polling now lives in the runtime-health query refetchInterval.
    // Keep the timeout retry here so stalled probes still force a fresh invalidation.
    hasRuntimeHealthTimeoutIssue(runtimeDefinitions, runtimeHealthByRuntime) &&
    !runtimeHealthFetching;

  return {
    retryRuntimeCheck,
    retryBeadsCheck,
    retryRuntimeHealth,
  };
};
