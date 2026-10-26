import type { AgentModelFavorite, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { STANDARD_SPEED } from "@openducktor/frontend-core/lib/model-catalog-selection";
import type { SelectOption } from "@openducktor/frontend-core/lib/select-option";
import type {
  ModelPickerRuntime,
  ModelPickerValue,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import Animated from "react-native-reanimated";
import { useAppTheme } from "@/theme/app-theme-context";
import { FormField, MenuSelect, SelectTrigger } from "@/ui/form-rows";
import { RuntimeIcon } from "@/ui/brand-icons";
import type { IconName } from "@/ui/icon";
import { StepTrack, type StepTrackFill } from "@/ui/step-track/step-track";
import { useShake } from "@/ui/use-shake";
import { effortControlKind, modelSummary, speedChoices } from "./model-field-model";
import type { ModelPickerLock } from "./model-picker-rows";
import { ModelPickerSheet } from "./model-picker-sheet";

/** The AICSS Reasoning Effort fill: a blue gradient, with a light blue tick beside the thumb. */
const EFFORT_FILLS: readonly StepTrackFill[] = [
  { from: "#006aff", to: "#0059d4", tick: "#66a6ff" },
];

export type EffortChoice = {
  options: readonly SelectOption[];
  value: string | null | undefined;
  /** The text of the field while it has no level, such as "Effort handled by runtime". */
  placeholder: string;
  /** The model name, which the track shows before the level while the user drags. */
  caption: string;
  disabled: boolean;
  onSelect: (value: string) => Promise<void> | void;
};

const NO_EFFORT_CHOICES: readonly SelectOption[] = [];

/** The effort levels of a model as a stepped track. A tap or a drag changes the effort. */
function EffortTrack({
  options,
  value,
  caption,
  disabled,
  onSelect,
}: {
  options: readonly SelectOption[];
  value: string;
  caption: string;
  disabled: boolean;
  onSelect: (value: string) => Promise<void> | void;
}): ReactElement {
  const stops = useMemo(
    () =>
      options.map((option) => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
      })),
    [options],
  );
  return (
    <StepTrack
      stops={stops}
      value={value}
      caption={caption}
      fills={EFFORT_FILLS}
      disabled={disabled}
      accessibilityLabel="Effort"
      onChange={onSelect}
    />
  );
}

/**
 * The effort levels of the selected model, next to the model as on desktop. A few levels show as
 * a stepped track, and the field names the chosen level. Many levels open a menu.
 */
export function EffortField({ effort }: { effort: EffortChoice }): ReactElement {
  const kind = effortControlKind(effort.options, effort.value);
  if (kind === "track" && effort.value) {
    const chosen = effort.options.find((option) => option.value === effort.value);
    return (
      <FormField label="Effort" value={chosen?.label}>
        <EffortTrack
          options={effort.options}
          value={effort.value}
          caption={effort.caption}
          disabled={effort.disabled}
          onSelect={effort.onSelect}
        />
      </FormField>
    );
  }
  // A model with no level to choose shows the placeholder, and the menu stays closed.
  const none = kind === "none";
  return (
    <FormField label="Effort">
      <MenuSelect
        title="Effort"
        icon="brain-cog"
        choices={none ? NO_EFFORT_CHOICES : effort.options}
        selected={effort.value}
        placeholder={none ? effort.placeholder : "Select effort"}
        disabled={effort.disabled}
        onSelect={(value) => void effort.onSelect(value)}
      />
    </FormField>
  );
}

/**
 * The desktop speed colors: quiet for Standard, amber for a fast level, and violet for
 * ultrafast. The thumb is white in both themes, so its marks keep their light colors.
 */
const useSpeedLook = (): ((level: string) => {
  fill: StepTrackFill;
  icon: IconName;
  color: string;
}) => {
  const theme = useAppTheme();
  const { palette } = theme;
  return (level) => {
    if (level === STANDARD_SPEED) {
      return {
        fill: { from: palette.slate400, to: palette.slate500, tick: palette.slate200 },
        icon: "zap-off",
        color: palette.slate500,
      };
    }
    if (level === "ultrafast") {
      return {
        fill: { from: palette.violet500, to: palette.violet700, tick: palette.violet300 },
        icon: "zap",
        color: palette.violet600,
      };
    }
    return {
      fill: { from: palette.amber400, to: palette.amber600, tick: palette.amber200 },
      icon: "zap",
      color: palette.amber600,
    };
  };
};

/**
 * The processing speed, as the desktop speed select: Standard and the faster levels of the model,
 * on a stepped track. The fill blends to the color of each level, and the zap in the thumb pops
 * with speed lines behind it when the speed goes up. A failed change shakes the control and
 * names the reason.
 */
export function SpeedField({
  control,
  caption,
  disabled = false,
}: {
  control: SpeedControlModel | null;
  /** The model name, which the track shows before the level while the user drags. */
  caption: string;
  disabled?: boolean | undefined;
}): ReactElement | null {
  const speedLook = useSpeedLook();
  const { style, shake } = useShake();
  const error = control?.error ?? null;
  useEffect(() => {
    if (error) shake();
  }, [error, shake]);
  const choices = speedChoices(control);
  if (!control || choices.length === 0) return null;
  const looks = choices.map((choice) => speedLook(choice.value));
  return (
    <FormField
      label="Speed"
      value={choices.find((choice) => choice.value === control.choice)?.label}
      error={control.error}
      hint={
        control.error
          ? null
          : (control.blockedReason ?? "Higher levels may cost more. Applies to the next turn.")
      }
    >
      <Animated.View style={style}>
        <StepTrack
          stops={choices}
          value={control.choice}
          caption={caption}
          fills={looks.map((look) => look.fill)}
          marks={{
            icons: looks.map((look) => look.icon),
            colors: looks.map((look) => look.color),
          }}
          disabled={disabled || control.disabled || control.pending}
          accessibilityLabel="Speed"
          onChange={control.onChange}
        />
      </Animated.View>
    </FormField>
  );
}

/**
 * The model of a form, as the desktop "Runtime and model" select: the runtime brand mark and the
 * model name, with its runtime and provider below. It opens the model picker sheet.
 */
export function ModelField({
  runtimes,
  favorites,
  lock = null,
  selection,
  fallbackRuntimeKind = null,
  placeholder,
  disabled = false,
  readOnlyReason = null,
  pickerDisabled = false,
  hint,
  error,
  onOpen,
  onChoose,
}: {
  runtimes: readonly ModelPickerRuntime[];
  favorites: readonly AgentModelFavorite[] | null;
  lock?: ModelPickerLock | null | undefined;
  selection: AgentModelSelection | null;
  /** The runtime of a session selection that does not name its runtime. */
  fallbackRuntimeKind?: RuntimeKind | null | undefined;
  placeholder: string;
  disabled?: boolean | undefined;
  /** Why the model cannot change now, such as a reuse. It shows under the field. */
  readOnlyReason?: string | null | undefined;
  /** True while a choice cannot apply, such as while the host connection is down. */
  pickerDisabled?: boolean | undefined;
  hint?: string | null | undefined;
  error?: string | null | undefined;
  /** Runs when the picker opens, such as to read stale catalogs again. */
  onOpen?: (() => void) | undefined;
  onChoose: (value: ModelPickerValue) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const summary = modelSummary(runtimes, selection, fallbackRuntimeKind);
  return (
    <FormField label="Runtime and model" hint={readOnlyReason ?? hint} error={error}>
      <SelectTrigger
        value={summary.title}
        placeholder={placeholder}
        detail={summary.detail}
        leading={
          summary.runtimeKind ? (
            <RuntimeIcon runtimeKind={summary.runtimeKind} size={20} />
          ) : undefined
        }
        icon="cpu"
        disabled={disabled || readOnlyReason !== null}
        onPress={() => {
          onOpen?.();
          setOpen(true);
        }}
        accessibilityLabel="Runtime and model"
        accessibilityHint="Opens the models of the runtimes."
      />
      <ModelPickerSheet
        visible={open}
        runtimes={runtimes}
        selection={selection}
        favorites={favorites}
        lock={lock}
        disabled={pickerDisabled}
        onChoose={onChoose}
        onClose={close}
      />
    </FormField>
  );
}
