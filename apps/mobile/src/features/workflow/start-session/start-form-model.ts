import type { AgentSessionStartMode } from "@openducktor/core";
import type { SelectOption } from "@openducktor/frontend-core/lib/select-option";
import {
  isSessionStartModeUnavailable,
  orderStartModesForDisplay,
  sessionStartModeButtonLabel,
} from "@openducktor/frontend-core/sessions/start/session-start-display";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";

export type StartModeOption = { value: AgentSessionStartMode; label: string; disabled: boolean };

/**
 * The start modes of the segmented control, in desktop order and with the desktop labels. Reuse
 * and fork need a source session, so they are disabled when the task has none. The list is empty
 * when the action allows one mode, because then the start has no choice of mode.
 */
export const startModeOptions = (
  model: Pick<SessionStartModalModel, "availableStartModes" | "existingSessionOptions">,
): StartModeOption[] => {
  if (model.availableStartModes.length <= 1) return [];
  const hasSources = model.existingSessionOptions.length > 0;
  return orderStartModesForDisplay(model.availableStartModes).map((value) => ({
    value,
    label: sessionStartModeButtonLabel(value),
    disabled: isSessionStartModeUnavailable(value, hasSources),
  }));
};

/** The short words that stay lowercase inside a title. */
const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
]);

/** A desktop button label in the title case of mobile buttons: "Run in background" is "Run in Background". */
export const titleCase = (label: string): string =>
  label
    .split(" ")
    .map((word, index) =>
      index > 0 && MINOR_WORDS.has(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");

/**
 * The optional fields of the start sheet, as the desktop start dialog. The model, effort, and
 * speed always show; reuse makes them read-only.
 */
export type StartFormSections = {
  sourceSession: boolean;
  targetBranch: boolean;
  profile: boolean;
};

export const startFormSections = (
  model: Pick<
    SessionStartModalModel,
    "selectedStartMode" | "showTargetBranchSelector" | "supportsProfiles"
  >,
): StartFormSections => ({
  sourceSession: model.selectedStartMode === "reuse" || model.selectedStartMode === "fork",
  targetBranch: model.showTargetBranchSelector === true,
  profile: model.supportsProfiles,
});

/** A choice handler that reports the edit first. */
const reported =
  <Value>(onEdit: () => void, choose: (value: Value) => void) =>
  (value: Value): void => {
    onEdit();
    choose(value);
  };

/** The handlers of the start choices that the user changes. */
export type StartChoiceHandlers = Pick<
  SessionStartModalModel,
  | "onSelectStartMode"
  | "onSelectSourceSessionValue"
  | "onSelectRuntimeProfile"
  | "onSelectModelPair"
  | "onSelectVariant"
  | "onSelectTargetBranch"
>;

/**
 * The choice handlers of a start that call `onEdit` first, so the sheet knows that the user
 * changed a choice and asks before it drops the choices.
 */
export const reportingChoices = (
  handlers: StartChoiceHandlers,
  onEdit: () => void,
): StartChoiceHandlers => {
  const choices: StartChoiceHandlers = {
    onSelectStartMode: reported(onEdit, handlers.onSelectStartMode),
    onSelectSourceSessionValue: reported(onEdit, handlers.onSelectSourceSessionValue),
    onSelectRuntimeProfile: reported(onEdit, handlers.onSelectRuntimeProfile),
    onSelectModelPair: reported(onEdit, handlers.onSelectModelPair),
    onSelectVariant: reported(onEdit, handlers.onSelectVariant),
  };
  if (handlers.onSelectTargetBranch) {
    choices.onSelectTargetBranch = reported(onEdit, handlers.onSelectTargetBranch);
  }
  return choices;
};

/** The speed control with a change handler that calls `onEdit` first. */
export const reportingSpeed = (
  control: SpeedControlModel | null,
  onEdit: () => void,
): SpeedControlModel | null =>
  control && { ...control, onChange: reported(onEdit, control.onChange) };

/** The label of the chosen option, or null when no option has the value. */
export const optionLabel = (
  options: readonly SelectOption[],
  value: string | undefined,
): string | null => options.find((option) => option.value === value)?.label ?? null;
