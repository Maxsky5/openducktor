import type { BeadsCheck, RuntimeCheck, RuntimeDescriptor } from "@openducktor/contracts";
import { ODT_MCP_SERVER_NAME } from "@/lib/openducktor-mcp";
import type {
  RepoRuntimeFailureKind,
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMap,
} from "@/types/diagnostics";

export type DiagnosticsToastIssue = {
  id: string;
  title: string;
  description: string;
  severity: Exclude<RepoRuntimeFailureKind, null>;
};

export type DiagnosticsRetryPlan = {
  retryRuntimeCheck: boolean;
  retryBeadsCheck: boolean;
  retryRuntimeHealth: boolean;
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

export const buildRuntimeHealthErrorMap = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeHealthError: string,
  checkedAt: string,
): RepoRuntimeHealthMap => {
  return Object.fromEntries(
    runtimeDefinitions.map((definition) => [
      definition.kind,
      {
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
      } satisfies RepoRuntimeHealthCheck,
    ]),
  ) as RepoRuntimeHealthMap;
};

export const buildTimeoutToastDescription = (label: string, detail: string | null): string => {
  if (!detail) {
    return `${label} is not yet available. Retrying automatically.`;
  }

  return `${label} is not yet available. Retrying automatically. Latest detail: ${detail}`;
};

const buildErrorToastDescription = (label: string, detail: string | null): string => {
  return detail ?? `${label} is unavailable.`;
};

const buildDiagnosticsToastIssue = ({
  id,
  label,
  detail,
  failureKind,
}: {
  id: string;
  label: string;
  detail: string | null;
  failureKind: Exclude<RepoRuntimeFailureKind, null>;
}): DiagnosticsToastIssue => {
  return failureKind === "timeout"
    ? {
        id,
        title: `${label} not yet available`,
        description: buildTimeoutToastDescription(label, detail),
        severity: failureKind,
      }
    : {
        id,
        title: `${label} unavailable`,
        description: buildErrorToastDescription(label, detail),
        severity: failureKind,
      };
};

export const buildDiagnosticsToastIssues = ({
  activeRepo,
  runtimeDefinitions,
  runtimeCheckError,
  runtimeCheckFailureKind,
  beadsCheckError,
  beadsCheckFailureKind,
  runtimeHealthByRuntime,
}: {
  activeRepo: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheckError: string | null;
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  beadsCheckError: string | null;
  beadsCheckFailureKind: RepoRuntimeFailureKind;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
}): DiagnosticsToastIssue[] => {
  if (activeRepo === null) {
    return [];
  }

  const issues: DiagnosticsToastIssue[] = [];

  if (runtimeCheckError && runtimeCheckFailureKind !== null) {
    issues.push(
      buildDiagnosticsToastIssue({
        id: "diagnostics:cli-tools",
        label: "CLI tools",
        detail: runtimeCheckError,
        failureKind: runtimeCheckFailureKind,
      }),
    );
  }

  if (beadsCheckError && beadsCheckFailureKind !== null) {
    issues.push(
      buildDiagnosticsToastIssue({
        id: "diagnostics:beads-store",
        label: "Beads store",
        detail: beadsCheckError,
        failureKind: beadsCheckFailureKind,
      }),
    );
  }

  for (const definition of runtimeDefinitions) {
    const runtimeHealth = runtimeHealthByRuntime[definition.kind];
    if (!runtimeHealth) {
      continue;
    }

    if (runtimeHealth.runtimeOk === false && runtimeHealth.runtimeFailureKind !== null) {
      issues.push(
        buildDiagnosticsToastIssue({
          id: `diagnostics:runtime:${definition.kind}`,
          label: `${definition.label} runtime`,
          detail: runtimeHealth.runtimeError,
          failureKind: runtimeHealth.runtimeFailureKind,
        }),
      );
      continue;
    }

    if (
      definition.capabilities.supportsMcpStatus &&
      runtimeHealth.mcpOk === false &&
      runtimeHealth.mcpFailureKind !== null
    ) {
      issues.push(
        buildDiagnosticsToastIssue({
          id: `diagnostics:mcp:${definition.kind}`,
          label: `${definition.label} OpenDucktor MCP`,
          detail: runtimeHealth.mcpServerError ?? runtimeHealth.mcpError,
          failureKind: runtimeHealth.mcpFailureKind,
        }),
      );
    }
  }

  return issues;
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
}: {
  activeRepo: string | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  runtimeCheckFetching: boolean;
  beadsCheckFailureKind: RepoRuntimeFailureKind;
  beadsCheckFetching: boolean;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  runtimeHealthFetching: boolean;
}): DiagnosticsRetryPlan => {
  return {
    retryRuntimeCheck: runtimeCheckFailureKind === "timeout" && !runtimeCheckFetching,
    retryBeadsCheck:
      activeRepo !== null && beadsCheckFailureKind === "timeout" && !beadsCheckFetching,
    retryRuntimeHealth:
      activeRepo !== null &&
      runtimeDefinitions.length > 0 &&
      hasRuntimeHealthTimeoutIssue(runtimeDefinitions, runtimeHealthByRuntime) &&
      !runtimeHealthFetching,
  };
};
