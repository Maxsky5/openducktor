import type {
  HostMcpBridgeCheck,
  HostRuntimeFailurePhase,
  HostRuntimeStatus,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { isHostRuntimeLifecycleBusy } from "@/lib/host-runtime-status";
import {
  getCliToolsCheckFailureDetail,
  hasCliToolCheckFailure,
} from "@/state/operations/workspace/check-diagnostics";
import {
  buildRefreshFailedSection,
  LOADING_STATUS,
  MUTED_VALUE,
  refreshFailureMessage,
  runtimeLabel,
} from "./diagnostics-check-section";
import type {
  BuildDiagnosticsPanelModelInput,
  DiagnosticKeyValueRowModel,
  DiagnosticsRuntimeAction,
  DiagnosticsRuntimeEntryModel,
  DiagnosticsRuntimesModel,
  DiagnosticsSectionModel,
  DiagnosticsStatus,
} from "./diagnostics-panel-model";

const CLI_TOOLS_TITLE = "CLI tools";
const MCP_BRIDGE_TITLE = "OpenDucktor MCP bridge";

export type HostDiagnosticsState = { reasons: string[]; isLoading: boolean };

export const collectHostState = (
  input: BuildDiagnosticsPanelModelInput,
  runtimes: DiagnosticsRuntimesModel,
): HostDiagnosticsState => {
  const reasons: string[] = [];
  if (input.runtimeDefinitionsError) {
    reasons.push(input.runtimeDefinitionsError);
  }
  if (input.runtimeStatus.streamError !== null || input.runtimeStatus.readError !== null) {
    reasons.push(runtimes.notice ?? "Runtime status is not current.");
  }
  for (const entry of runtimes.entries) {
    if (entry.status.health === "failed") {
      reasons.push(
        entry.failure
          ? `${entry.label}: ${entry.failure.message}`
          : `${entry.label} runtime has an error.`,
      );
    }
  }
  // A failed refresh takes priority over a retained earlier result.
  const { runtimeCheck, hostMcpBridgeCheck } = input;
  if (runtimeCheck.error !== null) {
    reasons.push(refreshFailureMessage(CLI_TOOLS_TITLE, runtimeCheck.error));
  } else {
    const cliDetail = getCliToolsCheckFailureDetail(runtimeCheck.data, null);
    if (cliDetail !== null) {
      reasons.push(cliDetail);
    }
  }
  if (hostMcpBridgeCheck.error !== null) {
    reasons.push(refreshFailureMessage(MCP_BRIDGE_TITLE, hostMcpBridgeCheck.error));
  } else if (hostMcpBridgeCheck.data?.state === "error") {
    reasons.push(hostMcpBridgeCheck.data.detail ?? "The OpenDucktor MCP bridge is unavailable.");
  }
  const isLoading =
    input.isLoadingRuntimeDefinitions ||
    input.runtimeStatus.isLoading ||
    runtimes.entries.some((entry) => entry.status.health === "busy") ||
    (runtimeCheck.data === null && runtimeCheck.error === null) ||
    (hostMcpBridgeCheck.data === null && hostMcpBridgeCheck.error === null);
  return { reasons, isLoading };
};

export const buildRuntimesModel = (
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsRuntimesModel => {
  const { runtimeDefinitions, runtimeStatus } = input;
  const entries = knownRuntimeKindValues.map((kind) =>
    buildRuntimeEntry(
      kind,
      runtimeLabel(runtimeDefinitions, kind),
      runtimeStatus.statusByKind[kind],
      input,
    ),
  );
  const notice = buildRuntimeStatusNotice(runtimeStatus);
  let status: DiagnosticsStatus;
  if (runtimeStatus.streamError !== null || runtimeStatus.readError !== null) {
    status = { health: "failed", label: "Not current" };
  } else if (entries.some((entry) => entry.status.health === "failed")) {
    status = { health: "failed", label: "Issue" };
  } else if (runtimeStatus.isLoading) {
    status = LOADING_STATUS;
  } else if (entries.some((entry) => entry.status.health === "busy")) {
    status = { health: "busy", label: "In progress" };
  } else {
    status = { health: "ok", label: "Current" };
  }
  return { status, notice, entries };
};

export const buildCliToolsSection = (
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsSectionModel => {
  const { runtimeDefinitions, runtimeDefinitionsError } = input;
  const { data: runtimeCheck, error, failureKind, observedAt } = input.runtimeCheck;
  const base = { key: "cli-tools", title: CLI_TOOLS_TITLE };
  const definitionErrors = runtimeDefinitionsError ? [runtimeDefinitionsError] : [];
  if (error !== null) {
    return buildRefreshFailedSection(
      base,
      { error, failureKind },
      runtimeCheck !== null && observedAt !== null
        ? { observedAt, rows: buildCliToolsRows(runtimeCheck, runtimeDefinitions) }
        : null,
      definitionErrors,
    );
  }
  if (runtimeCheck === null) {
    return {
      ...base,
      status: LOADING_STATUS,
      rows: [],
      errors: definitionErrors,
      emptyMessage: "CLI checks are loading.",
    };
  }
  const detail = getCliToolsCheckFailureDetail(runtimeCheck, null);
  return {
    ...base,
    status: hasCliToolCheckFailure(runtimeCheck)
      ? { health: "failed", label: "Issue" }
      : { health: "ok", label: "Available" },
    rows: buildCliToolsRows(runtimeCheck, runtimeDefinitions),
    errors: [...definitionErrors, ...(detail ? [detail] : [])],
  };
};

export const buildMcpBridgeSection = (
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsSectionModel => {
  const { data: check, error: readError } = input.hostMcpBridgeCheck;
  const base = { key: "mcp-bridge", title: MCP_BRIDGE_TITLE };
  if (readError !== null) {
    return buildRefreshFailedSection(
      base,
      { error: readError, failureKind: "error" },
      check === null ? null : { observedAt: check.checkedAt, rows: buildMcpBridgeRows(check) },
    );
  }
  if (check === null) {
    return {
      ...base,
      status: LOADING_STATUS,
      rows: [],
      errors: [],
      emptyMessage: "Bridge check is loading.",
    };
  }
  return check.state === "ready"
    ? {
        ...base,
        status: { health: "ok", label: "Ready" },
        rows: buildMcpBridgeRows(check),
        errors: [],
      }
    : {
        ...base,
        status: { health: "failed", label: "Error" },
        rows: buildMcpBridgeRows(check),
        errors: [check.detail ?? "The host cannot accept authenticated MCP requests."],
      };
};

const FAILURE_STAGE_LABELS = {
  configuration: "Configuration",
  start: "Start",
  run: "Run",
  stop: "Stop",
} satisfies Record<HostRuntimeFailurePhase, string>;

const HOST_RUNTIME_STATE_STATUSES = {
  disabled: { health: "neutral", label: "Disabled" },
  starting: { health: "busy", label: "Starting" },
  ready: { health: "ok", label: "Ready" },
  restarting: { health: "busy", label: "Restarting" },
  stopping: { health: "busy", label: "Stopping" },
  error: { health: "failed", label: "Error" },
} satisfies Record<HostRuntimeStatus["state"], DiagnosticsStatus>;

const PROGRESS_MESSAGES = {
  disabled: null,
  starting: "Starting the runtime.",
  ready: null,
  restarting: "Restarting the runtime.",
  stopping: "Stopping the runtime.",
  error: null,
} satisfies Record<HostRuntimeStatus["state"], string | null>;

const buildRuntimeEntry = (
  kind: RuntimeKind,
  label: string,
  status: HostRuntimeStatus | undefined,
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsRuntimeEntryModel => {
  if (status === undefined) {
    return {
      kind,
      label,
      status: input.runtimeStatus.isLoading
        ? LOADING_STATUS
        : { health: "neutral", label: "Unavailable" },
      rows: [],
      progress: null,
      failure: null,
      action: null,
      isLifecycleBusy: false,
    };
  }
  const cliVersion =
    input.runtimeCheck.data?.runtimes.find((entry) => entry.kind === kind && entry.ok)?.version ??
    null;
  return {
    kind,
    label,
    status: HOST_RUNTIME_STATE_STATUSES[status.state],
    rows: buildRuntimeEntryRows(status, cliVersion),
    progress: PROGRESS_MESSAGES[status.state],
    failure:
      status.state === "error" && status.failure !== null
        ? {
            stage: FAILURE_STAGE_LABELS[status.failure.phase],
            message: status.failure.message,
            nextAction: status.failure.nextAction,
          }
        : null,
    action: toRuntimeAction(status),
    isLifecycleBusy: isHostRuntimeLifecycleBusy(status.state),
  };
};

const toRuntimeAction = (status: HostRuntimeStatus): DiagnosticsRuntimeAction => {
  if (status.enabled) {
    return { type: "restart", label: "Restart" };
  }
  // A saved disable whose old runtime did not stop. Retry applies the saved choice.
  if (status.state === "error") {
    return { type: "restart", label: "Retry apply" };
  }
  return { type: "open_settings" };
};

const buildRuntimeEntryRows = (
  status: HostRuntimeStatus,
  cliVersion: string | null,
): DiagnosticKeyValueRowModel[] => {
  const rows: DiagnosticKeyValueRowModel[] = [
    { label: "Enabled", value: status.enabled ? "Yes" : "No" },
    {
      label: "Configured executable",
      value: status.configuredExecutablePath || "Default",
      mono: status.configuredExecutablePath.length > 0,
      breakAll: true,
      valueClassName: MUTED_VALUE,
    },
  ];
  if (
    status.effectiveExecutablePath !== null &&
    status.effectiveExecutablePath !== status.configuredExecutablePath
  ) {
    rows.push({
      label: "Effective executable",
      value: status.effectiveExecutablePath,
      mono: true,
      breakAll: true,
      valueClassName: MUTED_VALUE,
    });
  }
  if (status.version !== null) {
    rows.push({ label: "Version", value: status.version, mono: true });
  } else if (cliVersion !== null) {
    rows.push({
      label: "Executable version",
      value: cliVersion,
      mono: true,
      valueClassName: MUTED_VALUE,
    });
  }
  return rows;
};

const buildRuntimeStatusNotice = (
  runtimeStatus: BuildDiagnosticsPanelModelInput["runtimeStatus"],
): string | null => {
  if (runtimeStatus.streamError !== null) {
    return `Live runtime updates stopped: ${runtimeStatus.streamError} The states below are earlier results. Select Refresh Checks to read them again.`;
  }
  if (runtimeStatus.readError !== null) {
    return `Runtime status could not be read: ${runtimeStatus.readError} The states below are earlier results. Select Refresh Checks to try again.`;
  }
  if (runtimeStatus.isLoading) {
    return "Loading runtime status.";
  }
  return null;
};

const buildCliToolsRows = (
  runtimeCheck: RuntimeCheck,
  runtimeDefinitions: RuntimeDescriptor[],
): DiagnosticKeyValueRowModel[] => [
  { label: "Git", value: runtimeCheck.gitVersion ?? "Missing" },
  ...knownRuntimeKindValues.flatMap((kind) => {
    const cliHealth = runtimeCheck.runtimes.find((entry) => entry.kind === kind);
    return cliHealth
      ? [{ label: runtimeLabel(runtimeDefinitions, kind), value: formatCliRuntimeValue(cliHealth) }]
      : [];
  }),
];

const formatCliRuntimeValue = (cliHealth: RuntimeCheck["runtimes"][number]): string => {
  const value = cliHealth.ok ? "Found" : "Missing";
  return cliHealth.enabled === false ? `${value} (runtime disabled)` : value;
};

const buildMcpBridgeRows = (check: HostMcpBridgeCheck): DiagnosticKeyValueRowModel[] => [
  {
    label: "Host URL",
    value: check.hostUrl ?? "Unavailable",
    mono: check.hostUrl !== null,
    breakAll: true,
    valueClassName: MUTED_VALUE,
  },
  { label: "Checked at", value: check.checkedAt, mono: true, valueClassName: MUTED_VALUE },
];
