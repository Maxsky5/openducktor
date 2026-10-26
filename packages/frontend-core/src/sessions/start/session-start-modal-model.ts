import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import type { SelectOption } from "../../lib/select-option";
import type {
  ModelPickerFavoriteState,
  ModelPickerRuntime,
  ModelPickerValue,
} from "../model-selection/model-picker-model";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";

/** A session that a reuse or fork can start from. */
export type SessionStartSourceOption = SelectOption & {
  sourceSession: AgentSessionIdentity;
  selectedModel?: AgentModelSelection | null;
};

/** The choices that confirm a start. `true` or no input confirms nothing. */
export type SessionStartModalConfirmInput =
  | boolean
  | {
      runInBackground: boolean;
      startMode: AgentSessionStartMode;
      sourceSessionOptionValue: string | null;
      targetBranch?: string;
      kickoffPrompt?: string | undefined;
      speed?: string;
    };

export type SessionStartModalConfirmPayload = Exclude<SessionStartModalConfirmInput, boolean>;

export type SessionStartModalConfirmDraft = Omit<
  SessionStartModalConfirmPayload,
  "runInBackground"
>;

/** The state and handlers that a session start view shows. */
export type SessionStartModalModel = {
  open: boolean;
  requestId?: string | undefined;
  kickoffPrompt?: string | undefined;
  isKickoffPromptLoading?: boolean;
  kickoffPromptError?: string | null;
  onRetryKickoffPrompt?: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  backgroundConfirmLabel?: string;
  cancelLabel?: string;
  selectedModelSelection: AgentModelSelection | null;
  selectedRuntimeKind: RuntimeKind | null;
  modelPickerRuntimes: ModelPickerRuntime[];
  favoriteState: ModelPickerFavoriteState;
  supportsProfiles: boolean;
  supportsVariants: boolean;
  selectionCatalogError: string | null;
  isSelectionCatalogLoading: boolean;
  runtimeDefinitionsError: string | null;
  isRuntimeDefinitionsLoading: boolean;
  onRetryRuntimeDefinitions: () => void;
  runtimeSettingsError: string | null;
  isRuntimeSettingsLoading: boolean;
  hasRuntimeSettingsSnapshot: boolean;
  onRetryRuntimeSettings: () => void;
  runtimeProfileOptions: SelectOption[];
  variantOptions: SelectOption[];
  availableStartModes: AgentSessionStartMode[];
  selectedStartMode: AgentSessionStartMode;
  existingSessionOptions: SessionStartSourceOption[];
  selectedSourceSessionValue: string;
  showTargetBranchSelector?: boolean;
  targetBranchOptions?: SelectOption[];
  /** Empty when the start has no target branch yet, such as when the configured one is missing. */
  selectedTargetBranch?: string;
  /** Why the start cannot use the configured target branch, or null. */
  targetBranchError?: string | null;
  onSelectStartMode: (startMode: AgentSessionStartMode) => void;
  onSelectSourceSessionValue: (sourceSessionValue: string) => void;
  onSelectTargetBranch?: (branch: string) => void;
  onSelectRuntimeProfile: (profileId: string) => void;
  onSelectModelPair: (value: ModelPickerValue) => void;
  onSelectVariant: (variant: string) => void;
  allowRunInBackground?: boolean;
  isStarting: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onConfirm: (input?: SessionStartModalConfirmInput) => void;
};

export type SessionStartAvailability = {
  hasExistingSessionOptions: boolean;
  isReuseMode: boolean;
  requiresExistingSession: boolean;
  /** True while a start runs or while `blockedReason` is set. */
  confirmDisabled: boolean;
  /** Why Start is disabled, or null. A running start has no reason, as its progress shows. */
  blockedReason: string | null;
  runtimeProfileDisabled: boolean;
  variantDisabled: boolean;
};

/** The first cause that blocks Start, in the order that the user can fix the causes. */
const sessionStartBlockedReason = (
  model: SessionStartModalModel,
  kickoffInvalid: boolean,
): string | null => {
  if (model.isStarting) return null;
  const reuse = model.selectedStartMode === "reuse";
  const needsSource = reuse || model.selectedStartMode === "fork";
  if (model.isRuntimeDefinitionsLoading) return "Loading the runtimes…";
  if (model.runtimeDefinitionsError !== null) return "The runtimes did not load.";
  if (!model.hasRuntimeSettingsSnapshot && model.isRuntimeSettingsLoading) {
    return "Loading the runtime settings…";
  }
  if (!model.hasRuntimeSettingsSnapshot && model.runtimeSettingsError !== null) {
    return "The runtime settings did not load.";
  }
  if (model.isKickoffPromptLoading === true) return "Loading the kickoff prompt…";
  if (model.kickoffPromptError) return "The kickoff prompt did not load.";
  if (!reuse && model.selectionCatalogError !== null) return "The models did not load.";
  if (!reuse && model.isSelectionCatalogLoading) return "Loading the models…";
  if (model.showTargetBranchSelector && !model.selectedTargetBranch) {
    return "Choose a target branch to start.";
  }
  if (!reuse && (!model.selectedRuntimeKind || !model.selectedModelSelection)) {
    return "Choose a model to start.";
  }
  if (
    needsSource &&
    !model.existingSessionOptions.some(
      (option) => option.value === model.selectedSourceSessionValue,
    )
  ) {
    return "Choose a source session to start.";
  }
  if (kickoffInvalid) return "Write the custom instructions, or turn them off.";
  return null;
};

/**
 * Which fields of a start are usable, and whether the start can be confirmed. `kickoffInvalid` is
 * true when the custom instructions are on and blank.
 */
export const resolveSessionStartAvailability = (
  model: SessionStartModalModel,
  { kickoffInvalid }: { kickoffInvalid: boolean },
): SessionStartAvailability => {
  const {
    existingSessionOptions,
    selectedStartMode,
    isStarting,
    isSelectionCatalogLoading,
    selectedModelSelection,
    runtimeProfileOptions,
    supportsVariants,
    variantOptions,
  } = model;
  const hasExistingSessionOptions = existingSessionOptions.length > 0;
  const isReuseMode = selectedStartMode === "reuse";
  const requiresExistingSession = selectedStartMode === "reuse" || selectedStartMode === "fork";
  const blockedReason = sessionStartBlockedReason(model, kickoffInvalid);
  const confirmDisabled = isStarting || blockedReason !== null;
  const runtimeProfileDisabled =
    isStarting ||
    isReuseMode ||
    isSelectionCatalogLoading ||
    !selectedModelSelection ||
    runtimeProfileOptions.length === 0;
  const variantDisabled =
    isStarting ||
    isReuseMode ||
    isSelectionCatalogLoading ||
    !selectedModelSelection ||
    !supportsVariants ||
    variantOptions.length === 0;

  return {
    hasExistingSessionOptions,
    isReuseMode,
    requiresExistingSession,
    confirmDisabled,
    blockedReason,
    runtimeProfileDisabled,
    variantDisabled,
  };
};

/** The confirm input of the current choices. A start sends only the speed and prompt it changed. */
export const buildSessionStartConfirmDraft = ({
  model,
  requiresExistingSession,
  speedChange,
  kickoffPrompt,
}: {
  model: Pick<
    SessionStartModalModel,
    | "selectedStartMode"
    | "selectedSourceSessionValue"
    | "showTargetBranchSelector"
    | "selectedTargetBranch"
  >;
  requiresExistingSession: boolean;
  speedChange: string | undefined;
  kickoffPrompt: string | undefined;
}): SessionStartModalConfirmDraft => {
  const confirmInput: SessionStartModalConfirmDraft = {
    startMode: model.selectedStartMode,
    sourceSessionOptionValue: requiresExistingSession ? model.selectedSourceSessionValue : null,
  };
  if (speedChange !== undefined) confirmInput.speed = speedChange;
  if (kickoffPrompt !== undefined) confirmInput.kickoffPrompt = kickoffPrompt;
  if (model.showTargetBranchSelector) {
    confirmInput.targetBranch = model.selectedTargetBranch ?? "";
  }
  return confirmInput;
};
