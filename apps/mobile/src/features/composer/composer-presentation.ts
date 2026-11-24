import {
  type AgentMessageSubmitMode,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  type ModelSpeedTone,
  resolveModelTriggerSummary,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";
import { resolveModelSelectionOptions } from "@openducktor/frontend-core/sessions/model-selection/model-selection-options";

/** The placeholder of the message field and the hint that a screen reader reads with it. */
export type ComposerFieldText = { placeholder: string; hint: string | null };

/**
 * The field shows the placeholder of the composer policy, as the desktop composer: the trigger
 * keys, such as "@ for files; / for commands; $ for skills", or a state message, such as a pending
 * request. A screen reader reads the trigger keys as a sentence, and a state message as it is.
 */
export const composerFieldText = ({
  placeholder,
  hints,
}: {
  placeholder: string;
  /** The hints that the placeholder lists, or null when it tells the state of the session. */
  hints: readonly string[] | null;
}): ComposerFieldText => {
  if (hints === null) return { placeholder, hint: placeholder };
  return { placeholder, hint: hints.length > 0 ? `Type ${hints.join(", ")}.` : null };
};

/**
 * The look of the desktop Send button. It always shows: half transparent while there is nothing
 * to send or while send is closed, and with a loader while a send prepares.
 */
export type SendButtonState = "blocked" | "ready" | "busy";

export const sendButtonState = ({
  hasContent,
  sendDisabled,
  busy,
}: {
  /** True when the draft or the pending review comments have something to send. */
  hasContent: boolean;
  sendDisabled: boolean;
  busy: boolean;
}): SendButtonState => {
  if (busy) return "busy";
  return hasContent && !sendDisabled ? "ready" : "blocked";
};

/**
 * True while the second send control, Steer or Queue for one message during a turn, cannot send.
 * It runs the checks of the submit, so an open control always sends: a steer needs open input
 * and a runtime that can steer, and a queued message also needs attachments that the selected
 * model takes.
 */
export const secondarySendDisabled = ({
  mode,
  gateOpen,
  settingsReady,
  sendInputBlocked,
  defaultSendDisabled,
  steerBlockedReason,
}: {
  mode: AgentMessageSubmitMode;
  gateOpen: boolean;
  settingsReady: boolean;
  sendInputBlocked: boolean;
  defaultSendDisabled: boolean;
  steerBlockedReason: string | null;
}): boolean => {
  if (!gateOpen || !settingsReady) return true;
  return mode === "steer" ? sendInputBlocked || steerBlockedReason !== null : defaultSendDisabled;
};

/** The look of the composer card: the warning outline while the session waits for input. */
export type ComposerCardState = "waiting" | "muted" | "active";

export const composerCardState = ({
  isWaitingInput,
  inputDisabled,
  isSubmitting,
}: {
  isWaitingInput: boolean;
  inputDisabled: boolean;
  isSubmitting: boolean;
}): ComposerCardState => {
  if (isWaitingInput) return "waiting";
  // A send keeps the card active while it locks the field.
  return inputDisabled && !isSubmitting ? "muted" : "active";
};

/** The text of the model control: runtime profile, model name, effort, speed tone, and a11y label. */
export type ComposerModelText = {
  label: string;
  /** The OpenCode profile label, which the model control shows before the model name. */
  profile: string | null;
  /** The effort level, which the model control shows after the model name. */
  effort: string | null;
  /** The active speed tone; non-standard tones show a colored zap icon. */
  speedTone: ModelSpeedTone;
  /** The full accessible label including runtime, profile, model, effort, and speed. */
  accessibilityLabel: string;
};

export const composerModelText = ({
  selectedModel,
  modelName,
  catalog,
  runtime,
}: {
  selectedModel: AgentModelSelection | null;
  /** The catalog name of the selected model, when the catalog has the model. */
  modelName: string | undefined;
  catalog: AgentModelCatalog | null;
  runtime?: RuntimeDescriptor | null | undefined;
}): ComposerModelText => {
  const resolvedRuntime =
    runtime ??
    catalog?.runtime ??
    (selectedModel?.runtimeKind ? RUNTIME_DESCRIPTORS_BY_KIND[selectedModel.runtimeKind] : null);
  const options = selectedModel
    ? resolveModelSelectionOptions({
        liveSession: true,
        selectionCatalog: catalog,
        selectedModelSelection: selectedModel,
      })
    : null;
  const summary = resolveModelTriggerSummary({
    runtime: resolvedRuntime,
    catalog,
    selection: selectedModel,
    profileOptions: options?.agentProfileOptions,
    effortOptions: options?.variantOptions,
    placeholder: "Model",
  });
  return {
    label: selectedModel ? (modelName ?? summary.modelLabel) : "Model",
    profile: summary.profileLabel,
    effort: summary.effortLabel,
    speedTone: summary.speedTone,
    accessibilityLabel: selectedModel ? summary.ariaLabel : "Select model",
  };
};
