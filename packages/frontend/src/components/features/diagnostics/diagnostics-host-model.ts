import type {
  HostMcpBridgeStatus,
  HostRuntimeFailurePhase,
  HostRuntimeStatus,
  RuntimeCheck,
  RuntimeKind,
} from "@openducktor/contracts";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { isHostRuntimeLifecycleBusy } from "@/lib/host-runtime-status";
import {
  getCliToolsCheckFailureDetail,
  hasCliToolCheckFailure,
} from "@/state/operations/workspace/check-diagnostics";
import {
  buildRefreshFailedCheck,
  LOADING_STATUS,
  refreshFailureMessage,
  runtimeLabel,
} from "./diagnostics-check-section";
import type {
  BuildDiagnosticsPanelModelInput,
  DiagnosticsCheckBase,
  DiagnosticsCheckModel,
  DiagnosticsHostModel,
  DiagnosticsRuntimeAction,
  DiagnosticsRuntimeEntryModel,
  DiagnosticsRuntimeFailureModel,
  DiagnosticsRuntimesModel,
  DiagnosticsStatus,
} from "./diagnostics-panel-model";

const GIT_TITLE = "Git";
const MCP_BRIDGE_TITLE = "OpenDucktor MCP bridge";

export type HostDiagnosticsState = { reasons: string[]; isLoading: boolean };

export const buildHostModel = (input: BuildDiagnosticsPanelModelInput): DiagnosticsHostModel => ({
  runtimes: buildRuntimesModel(input),
  tools: [buildGitCheck(input), buildMcpBridgeCheck(input)],
});

export const collectHostState = (
  input: BuildDiagnosticsPanelModelInput,
  host: DiagnosticsHostModel,
): HostDiagnosticsState => {
  const { runtimes } = host;
  const reasons: string[] = [];
  if (input.runtimeDefinitionsError) {
    reasons.push(input.runtimeDefinitionsError);
  }
  if (input.runtimeStatus.streamError !== null || input.runtimeStatus.readError !== null) {
    reasons.push(runtimes.notice ?? "Runtime status is not current.");
  }
  // The runtime row shows the full cause. The issue list stays short.
  for (const kind of knownRuntimeKindValues) {
    const status = input.runtimeStatus.statusByKind[kind];
    if (status?.state !== "error") continue;
    const summary = status.failure ? FAILURE_SUMMARIES[status.failure.phase] : "has an error";
    reasons.push(`The ${runtimeLabel(input.runtimeDefinitions, kind)} runtime ${summary}.`);
  }
  // A failed refresh takes priority over a retained earlier result.
  const { runtimeCheck } = input;
  const mcpBridge = input.runtimeStatus.snapshot?.mcpBridge ?? null;
  if (runtimeCheck.error !== null) {
    reasons.push(refreshFailureMessage(GIT_TITLE, runtimeCheck.error));
  } else {
    const cliDetail = getCliToolsCheckFailureDetail(runtimeCheck.data, null);
    if (cliDetail !== null) {
      reasons.push(cliDetail);
    }
  }
  if (mcpBridge?.state === "failed") {
    reasons.push(mcpBridge.failure ?? "The OpenDucktor MCP bridge did not start.");
  }
  const isLoading =
    input.isLoadingRuntimeDefinitions ||
    input.runtimeStatus.isLoading ||
    runtimes.entries.some((entry) => entry.status.health === "busy") ||
    (runtimeCheck.data === null && runtimeCheck.error === null) ||
    mcpBridge?.state === "starting";
  return { reasons, isLoading };
};

const buildRuntimesModel = (input: BuildDiagnosticsPanelModelInput): DiagnosticsRuntimesModel => ({
  notice: buildRuntimeStatusNotice(input.runtimeStatus),
  entries: knownRuntimeKindValues.map((kind) =>
    buildRuntimeEntry(
      kind,
      runtimeLabel(input.runtimeDefinitions, kind),
      input.runtimeStatus.statusByKind[kind],
      input,
    ),
  ),
});

const stripGitPrefix = (version: string): string => version.replace(/^git version\s+/i, "");

const buildGitCheck = (input: BuildDiagnosticsPanelModelInput): DiagnosticsCheckModel => {
  const { runtimeDefinitionsError } = input;
  const { data: runtimeCheck, error, failureKind, observedAt } = input.runtimeCheck;
  const definitionErrors = runtimeDefinitionsError ? [runtimeDefinitionsError] : [];
  const base: DiagnosticsCheckBase = {
    key: "git",
    title: GIT_TITLE,
    value: runtimeCheck?.gitVersion ? stripGitPrefix(runtimeCheck.gitVersion) : null,
    details: [],
  };
  if (error !== null) {
    return buildRefreshFailedCheck(base, { error, failureKind }, observedAt, definitionErrors);
  }
  if (runtimeCheck === null) {
    return { ...base, status: LOADING_STATUS, notice: null, errors: definitionErrors };
  }
  const detail = getCliToolsCheckFailureDetail(runtimeCheck, null);
  let status: DiagnosticsStatus = { health: "ok", label: "Available" };
  if (!runtimeCheck.gitOk) {
    status = { health: "failed", label: "Missing" };
  } else if (hasCliToolCheckFailure(runtimeCheck)) {
    status = { health: "failed", label: "Issue" };
  }
  return {
    ...base,
    status,
    notice: null,
    errors: [...definitionErrors, ...(detail ? [detail] : [])],
  };
};

const MCP_BRIDGE_STATUSES = {
  starting: { health: "busy", label: "Starting" },
  ready: { health: "ok", label: "Ready" },
  failed: { health: "failed", label: "Error" },
} satisfies Record<HostMcpBridgeStatus["state"], DiagnosticsStatus>;

/** The host publishes each bridge state change, so this row follows the bridge without a check. */
const buildMcpBridgeCheck = (input: BuildDiagnosticsPanelModelInput): DiagnosticsCheckModel => {
  const bridge = input.runtimeStatus.snapshot?.mcpBridge ?? null;
  const base: DiagnosticsCheckBase = {
    key: "mcp-bridge",
    title: MCP_BRIDGE_TITLE,
    value: null,
    details: bridge?.hostUrl ? [{ label: "Address", value: bridge.hostUrl, isPath: true }] : [],
  };
  if (bridge === null) {
    const status: DiagnosticsStatus = input.runtimeStatus.isLoading
      ? LOADING_STATUS
      : { health: "neutral", label: "Unavailable" };
    return { ...base, status, notice: null, errors: [] };
  }
  return {
    ...base,
    status: MCP_BRIDGE_STATUSES[bridge.state],
    notice: null,
    errors: bridge.failure === null ? [] : [bridge.failure],
  };
};

const FAILURE_SUMMARIES = {
  configuration: "could not read its settings",
  start: "could not start",
  run: "stopped unexpectedly",
  stop: "could not stop",
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
  starting: "Starting the runtime…",
  ready: null,
  restarting: "Restarting the runtime…",
  stopping: "Stopping the runtime…",
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
      version: null,
      executablePath: null,
      effectiveExecutablePath: null,
      executableWarning: null,
      progress: null,
      failure: null,
      action: null,
      isLifecycleBusy: false,
    };
  }
  const executable = input.runtimeCheck.data?.runtimes.find((entry) => entry.kind === kind);
  return {
    kind,
    label,
    status: HOST_RUNTIME_STATE_STATUSES[status.state],
    version: status.version ?? (executable?.ok ? executable.version : null),
    executablePath: status.configuredExecutablePath || null,
    effectiveExecutablePath:
      status.effectiveExecutablePath !== null &&
      status.effectiveExecutablePath !== status.configuredExecutablePath
        ? status.effectiveExecutablePath
        : null,
    executableWarning: buildExecutableWarning(status, executable),
    progress: PROGRESS_MESSAGES[status.state],
    failure: buildRuntimeFailure(status),
    action: toRuntimeAction(status),
    isLifecycleBusy: isHostRuntimeLifecycleBusy(status.state),
  };
};

const buildExecutableWarning = (
  status: HostRuntimeStatus,
  executable: RuntimeCheck["runtimes"][number] | undefined,
): string | null => {
  // A ready runtime proves its executable. The check only explains a runtime that is not ready.
  if (!status.enabled || status.state === "ready" || executable === undefined || executable.ok) {
    return null;
  }
  return executable.error ?? "The executable check could not find this executable.";
};

const buildRuntimeFailure = (status: HostRuntimeStatus): DiagnosticsRuntimeFailureModel | null =>
  status.state === "error" && status.failure !== null
    ? { message: status.failure.message, nextAction: status.failure.nextAction }
    : null;

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

const buildRuntimeStatusNotice = (
  runtimeStatus: BuildDiagnosticsPanelModelInput["runtimeStatus"],
): string | null => {
  if (runtimeStatus.streamError !== null) {
    return `Live runtime updates stopped: ${runtimeStatus.streamError} These states can be out of date. Select Refresh to read them again.`;
  }
  if (runtimeStatus.readError !== null) {
    return `Runtime status could not be read: ${runtimeStatus.readError} These states can be out of date. Select Refresh to try again.`;
  }
  return null;
};
