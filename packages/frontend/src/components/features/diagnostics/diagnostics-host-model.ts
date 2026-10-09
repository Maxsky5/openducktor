import type {
  HostMcpBridgeStatus,
  HostRuntimeFailurePhase,
  HostRuntimeStatus,
  RuntimeKind,
} from "@openducktor/contracts";
import { knownRuntimeKindValues } from "@openducktor/contracts";
import { isHostRuntimeLifecycleBusy } from "@/lib/host-runtime-status";
import { buildRefreshFailedCheck, LOADING_STATUS, runtimeLabel } from "./diagnostics-check-section";
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

const PATH_TITLE = "PATH";
const GIT_TITLE = "Git";
const MCP_BRIDGE_TITLE = "OpenDucktor MCP bridge";

export type HostDiagnosticsState = { reasons: string[]; isLoading: boolean };

export const buildHostModel = (input: BuildDiagnosticsPanelModelInput): DiagnosticsHostModel => ({
  runtimes: buildRuntimesModel(input),
  tools: [buildPathCheck(input), buildGitCheck(input), buildMcpBridgeCheck(input)],
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
  const mcpBridge = input.runtimeStatus.snapshot?.mcpBridge ?? null;
  for (const check of host.tools) {
    if (check.key === "path" || check.key === "git") reasons.push(...check.errors);
  }
  if (mcpBridge?.state === "failed") {
    reasons.push(mcpBridge.failure ?? "The OpenDucktor MCP bridge did not start.");
  }
  const isLoading =
    input.isLoadingRuntimeDefinitions ||
    input.runtimeStatus.isLoading ||
    runtimes.entries.some((entry) => entry.status.health === "busy") ||
    host.tools.some((check) => check.status.health === "loading") ||
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

const buildPathCheck = (input: BuildDiagnosticsPanelModelInput): DiagnosticsCheckModel => {
  const { data, error, failureKind, observedAt } = input.pathCheck;
  const base: DiagnosticsCheckBase = { key: "path", title: PATH_TITLE, value: null, details: [] };
  if (error !== null) {
    return buildRefreshFailedCheck(base, { error, failureKind }, observedAt);
  }
  if (data === null) {
    return { ...base, status: LOADING_STATUS, notice: null, errors: [] };
  }
  return {
    ...base,
    status: data.ok ? { health: "ok", label: "Available" } : { health: "failed", label: "Issue" },
    notice: null,
    errors: data.ok ? [] : [data.error ?? "The user PATH is unavailable."],
  };
};

const buildGitCheck = (input: BuildDiagnosticsPanelModelInput): DiagnosticsCheckModel => {
  const { data, error, failureKind, observedAt } = input.gitCheck;
  const base: DiagnosticsCheckBase = {
    key: "git",
    title: GIT_TITLE,
    value: data?.version ? stripGitPrefix(data.version) : null,
    details: data?.executablePath
      ? [{ label: "Executable", value: data.executablePath, isPath: true }]
      : [],
  };
  if (error !== null) {
    return buildRefreshFailedCheck(base, { error, failureKind }, observedAt);
  }
  if (data === null) {
    return { ...base, status: LOADING_STATUS, notice: null, errors: [] };
  }
  return {
    ...base,
    status: data.ok ? { health: "ok", label: "Available" } : { health: "failed", label: "Issue" },
    notice: null,
    errors: data.ok ? [] : [data.error ?? "Git is unavailable."],
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
      progress: null,
      failure: null,
      action: null,
      isLifecycleBusy: false,
    };
  }
  return {
    kind,
    label,
    status: HOST_RUNTIME_STATE_STATUSES[status.state],
    version: status.version,
    executablePath: status.configuredExecutablePath || null,
    effectiveExecutablePath:
      status.effectiveExecutablePath !== null &&
      status.effectiveExecutablePath !== status.configuredExecutablePath
        ? status.effectiveExecutablePath
        : null,
    progress: PROGRESS_MESSAGES[status.state],
    failure: buildRuntimeFailure(status),
    action: toRuntimeAction(status),
    isLifecycleBusy: isHostRuntimeLifecycleBusy(status.state),
  };
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
