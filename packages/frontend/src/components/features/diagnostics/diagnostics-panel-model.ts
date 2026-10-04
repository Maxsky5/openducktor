import type {
  HostMcpBridgeCheck,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
  TaskStoreCheck,
  WorkspaceRecord,
  WorkspaceRuntimeMcpCheck,
} from "@openducktor/contracts";
import type { CheckRead, ObservedCheck } from "@/types/diagnostics";
import type { HostRuntimeStatusContextValue } from "@/types/state-slices";
import {
  buildCliToolsSection,
  buildMcpBridgeSection,
  buildRuntimesModel,
  collectHostState,
} from "./diagnostics-host-model";
import { buildDiagnosticsSummary, type DiagnosticsSummary } from "./diagnostics-model";
import { collectWorkspaceState } from "./diagnostics-workspace-model";

export const buildDiagnosticsPanelModel = (
  input: BuildDiagnosticsPanelModelInput,
): DiagnosticsPanelModel => {
  const runtimes = buildRuntimesModel(input);
  const host = collectHostState(input, runtimes);
  const workspace = collectWorkspaceState(input);
  const criticalReasons = [...host.reasons, ...workspace.reasons];
  const isSummaryChecking = host.isLoading || workspace.isLoading;

  return {
    host: {
      runtimes,
      cliTools: buildCliToolsSection(input),
      mcpBridge: buildMcpBridgeSection(input),
    },
    workspace: workspace.model,
    isSummaryChecking,
    summaryState: buildDiagnosticsSummary({
      isChecking: isSummaryChecking,
      hasCriticalIssues: criticalReasons.length > 0,
      hasSetupIssues: workspace.hasWarning,
    }),
    criticalReasons,
    hasHostBlockingFailure: host.reasons.length > 0,
    hasWorkspaceBlockingFailure: workspace.reasons.length > 0,
  };
};

/** Health of one check, computed from check data. Rendering maps it to a badge. */
export type DiagnosticsHealth = "ok" | "loading" | "busy" | "warning" | "failed" | "neutral";

export type DiagnosticsStatus = {
  health: DiagnosticsHealth;
  label: string;
};

export type DiagnosticKeyValueRowModel = {
  label: string;
  value: string;
  mono?: boolean;
  breakAll?: boolean;
  valueClassName?: string;
};

export type DiagnosticsSectionModel = {
  key: string;
  title: string;
  status: DiagnosticsStatus;
  /** Marks the rows as an earlier result after a failed refresh. */
  notice?: string;
  rows: DiagnosticKeyValueRowModel[];
  errors: string[];
  emptyMessage?: string;
};

export type DiagnosticsRuntimeAction =
  | { type: "restart"; label: "Restart" | "Retry apply" }
  | { type: "open_settings" };

export type DiagnosticsRuntimeEntryModel = {
  kind: RuntimeKind;
  label: string;
  status: DiagnosticsStatus;
  rows: DiagnosticKeyValueRowModel[];
  progress: string | null;
  failure: { stage: string; message: string; nextAction: string } | null;
  action: DiagnosticsRuntimeAction | null;
  isLifecycleBusy: boolean;
};

export type DiagnosticsRuntimesModel = {
  status: DiagnosticsStatus;
  /** Explains why the shown state is loading, earlier, or unavailable. */
  notice: string | null;
  entries: DiagnosticsRuntimeEntryModel[];
};

export type DiagnosticsMcpObservationModel = {
  key: string;
  workingDirectory: string;
  status: DiagnosticsStatus;
  rows: DiagnosticKeyValueRowModel[];
  error: string | null;
};

export type DiagnosticsRuntimeMcpEntryModel = {
  kind: RuntimeKind;
  label: string;
  status: DiagnosticsStatus;
  detail: string | null;
  observations: DiagnosticsMcpObservationModel[];
};

export type DiagnosticsRuntimeMcpModel = {
  status: DiagnosticsStatus;
  /** Marks the entries as an earlier result after a failed refresh. */
  notice?: string;
  errors: string[];
  emptyMessage?: string;
  entries: DiagnosticsRuntimeMcpEntryModel[];
};

export type DiagnosticsWorkspaceModel =
  | { kind: "none"; emptyMessage: string }
  | {
      kind: "selected";
      name: string;
      path: string;
      repositorySetup: DiagnosticsSectionModel;
      taskStore: DiagnosticsSectionModel;
      runtimeMcp: DiagnosticsRuntimeMcpModel;
    };

export type DiagnosticsPanelModel = {
  host: {
    runtimes: DiagnosticsRuntimesModel;
    cliTools: DiagnosticsSectionModel;
    mcpBridge: DiagnosticsSectionModel;
  };
  workspace: DiagnosticsWorkspaceModel;
  isSummaryChecking: boolean;
  summaryState: DiagnosticsSummary;
  criticalReasons: string[];
  hasHostBlockingFailure: boolean;
  hasWorkspaceBlockingFailure: boolean;
};

export type BuildDiagnosticsPanelModelInput = {
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeStatus: Pick<
    HostRuntimeStatusContextValue,
    "statusByKind" | "isCurrent" | "isLoading" | "readError" | "streamError"
  >;
  runtimeCheck: ObservedCheck<RuntimeCheck>;
  hostMcpBridgeCheck: CheckRead<HostMcpBridgeCheck>;
  workspace: WorkspaceRecord | null;
  /** The repository that the workspace checks below describe. */
  checksRepoPath: string | null;
  taskStoreCheck: ObservedCheck<TaskStoreCheck>;
  workspaceRuntimeMcpCheck: CheckRead<WorkspaceRuntimeMcpCheck>;
};
