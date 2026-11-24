import { STANDARD_SPEED } from "@openducktor/core";
import type { SelectOption } from "@openducktor/frontend-core/lib/select-option";
import type {
  ModelPickerRuntime,
  ModelPickerSelectionPolicy,
  ModelPickerValue,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { type ReactElement, useId, useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { OptionList } from "./model-picker-option-list";
import { ModelPickerSpeedSection } from "./model-picker-speed-section";
import type {
  ModelPickerEffortOptions,
  ModelPickerOptionsPane as ModelPickerOptionsPanePropsModel,
  ModelPickerProfileOptions,
} from "./model-picker-types";
import {
  StepTrackSlider,
  type StepTrackSliderFill,
  type StepTrackSliderStop,
} from "./step-track-slider";
import "./step-track-slider.css";

const MAX_EFFORT_SLIDER_STOPS = 7;

const EFFORT_FILLS: readonly StepTrackSliderFill[] = [
  { from: "#006aff", to: "#0059d4", tick: "#66a6ff" },
];

const LIVE_LOCKED_PROFILE_DESCRIPTION = "Start a new session to change the agent profile.";

const resolveEffortSectionStatus = (
  isCatalogLoading: boolean,
  supportsVariants: boolean,
  optionCount: number,
): string | null => {
  if (isCatalogLoading && optionCount === 0) return "Loading effort options…";
  if (!supportsVariants) return "Effort is managed by the runtime.";
  if (optionCount === 0) return "This model has no effort options.";
  return null;
};

const shouldUseEffortSlider = (
  options: readonly SelectOption[],
  value: string | undefined,
): boolean =>
  Boolean(value) &&
  options.length >= 2 &&
  options.length <= MAX_EFFORT_SLIDER_STOPS &&
  !options.some((option) => option.disabled === true) &&
  options.some((option) => option.value === value);

function EffortSliderSection({
  effort,
  value,
  disabledReason,
  descriptionId,
}: {
  effort: ModelPickerEffortOptions;
  value: string;
  disabledReason: string | null;
  descriptionId: string;
}): ReactElement {
  const stops = useMemo<readonly StepTrackSliderStop[]>(
    () =>
      effort.options.map((option) => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
      })),
    [effort.options],
  );

  return (
    <section aria-label="Effort" className="flex min-w-0 flex-col">
      <div className="flex items-end gap-2.5">
        <span className="flex h-7 shrink-0 items-center text-xs font-medium text-muted-foreground">
          Effort
        </span>
        <div className="min-w-0 flex-1">
          <StepTrackSlider
            stops={stops}
            value={value}
            fills={EFFORT_FILLS}
            ariaLabel="Effort"
            ariaDescribedBy={disabledReason ? descriptionId : undefined}
            disabled={disabledReason !== null}
            onChange={effort.onSelect}
          />
        </div>
      </div>
      {disabledReason ? (
        <p id={descriptionId} className="pt-1 text-[11px] leading-snug text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </section>
  );
}

function EffortFallbackSection({
  effort,
  statusText,
  disabledReason,
  descriptionId,
}: {
  effort: ModelPickerEffortOptions;
  statusText: string | null;
  disabledReason: string | null;
  descriptionId: string;
}): ReactElement {
  const activeLabel = effort.options.find((option) => option.value === effort.value)?.label;
  return (
    <section aria-label="Effort" className="flex min-w-0 flex-col gap-1.5 pt-2">
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Effort</span>
        {statusText ? (
          <p className="truncate text-xs text-muted-foreground" role="status">
            {statusText}
          </p>
        ) : activeLabel ? (
          <span className="ml-auto truncate text-xs font-medium text-foreground">
            {activeLabel}
          </span>
        ) : null}
      </div>
      {!statusText ? (
        <OptionList
          ariaLabel="Effort levels"
          items={effort.options.map((option) => ({
            value: option.value,
            label: option.label,
            description: option.description,
            disabled: option.disabled || disabledReason !== null,
          }))}
          selectedValue={effort.value}
          onSelect={(next) => void effort.onSelect(next)}
          maxHeightClassName="max-h-24 overflow-y-auto"
          layout={effort.options.length >= 2 ? "grid" : "stack"}
        />
      ) : null}
      {disabledReason && !statusText ? (
        <p id={descriptionId} className="text-[11px] leading-snug text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </section>
  );
}

function EffortSection({
  effort,
  supportsVariants,
  isCatalogLoading,
  lockedReason,
}: {
  effort: ModelPickerEffortOptions;
  supportsVariants: boolean;
  isCatalogLoading: boolean;
  lockedReason: string | null;
}): ReactElement {
  const descriptionId = useId();
  const disabledReason = lockedReason ?? effort.disabledReason ?? null;
  const statusText = resolveEffortSectionStatus(
    isCatalogLoading,
    supportsVariants,
    effort.options.length,
  );

  if (!statusText && shouldUseEffortSlider(effort.options, effort.value) && effort.value) {
    return (
      <EffortSliderSection
        effort={effort}
        value={effort.value}
        disabledReason={disabledReason}
        descriptionId={descriptionId}
      />
    );
  }
  return (
    <EffortFallbackSection
      effort={effort}
      statusText={statusText}
      disabledReason={disabledReason}
      descriptionId={descriptionId}
    />
  );
}

const toProfileComboboxOption = (option: SelectOption, disabled: boolean): ComboboxOption => {
  const item: ComboboxOption = {
    value: option.value,
    label: option.label,
    disabled,
  };
  if (option.description) {
    item.description = option.description;
  }
  return item;
};

function ProfileSection({
  profile,
  isCatalogLoading,
  lockedReason,
  alignWithTrack,
}: {
  profile: ModelPickerProfileOptions;
  isCatalogLoading: boolean;
  lockedReason: string | null;
  alignWithTrack: boolean;
}): ReactElement {
  const labelId = useId();
  const descriptionId = useId();
  const options = profile.options;
  const allLiveLocked =
    options.length > 0 &&
    options.every(
      (option) =>
        option.disabled === true && option.description === LIVE_LOCKED_PROFILE_DESCRIPTION,
    );
  const disabledReason =
    lockedReason ??
    profile.disabledReason ??
    (allLiveLocked ? LIVE_LOCKED_PROFILE_DESCRIPTION : null);
  const statusText =
    isCatalogLoading && options.length === 0
      ? "Loading agent profiles…"
      : options.length === 0
        ? "No visible agent profiles are available."
        : null;
  const comboboxOptions = useMemo(
    () =>
      options.map((option) =>
        toProfileComboboxOption(option, option.disabled === true || disabledReason !== null),
      ),
    [disabledReason, options],
  );

  return (
    <section
      aria-label="Agent profile"
      className={cn("flex min-w-0 flex-col", alignWithTrack ? "pt-[20px]" : "pt-2")}
    >
      <div className="flex items-center gap-2.5">
        <span
          id={labelId}
          className="flex h-7 shrink-0 items-center text-xs font-medium text-muted-foreground"
        >
          Profile
        </span>
        {statusText ? (
          <p className="flex h-7 items-center text-xs text-muted-foreground" role="status">
            {statusText}
          </p>
        ) : (
          <div className="min-w-0 flex-1">
            <Combobox
              value={profile.value ?? ""}
              onValueChange={(next) => {
                if (next !== profile.value) {
                  profile.onSelect(next);
                }
              }}
              options={comboboxOptions}
              placeholder="Select profile"
              searchPlaceholder="Search profiles..."
              emptyText="No profile found."
              searchable={options.length > 4}
              disabled={disabledReason !== null}
              popoverSide="top"
              triggerAriaLabelledBy={labelId}
              triggerAriaDescribedBy={disabledReason ? descriptionId : undefined}
              triggerClassName="h-7 rounded-lg border-border/80 bg-card px-2.5 text-xs font-medium shadow-2xs hover:bg-accent/50"
              className="z-[95] min-w-[13rem] max-w-[18rem]"
            />
          </div>
        )}
      </div>
      {disabledReason && !statusText ? (
        <p id={descriptionId} className="pt-1 text-[11px] leading-snug text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </section>
  );
}

const resolveOptionsPaneState = ({
  selectedRuntime,
  value,
  selectionPolicy,
  options,
}: {
  selectedRuntime: ModelPickerRuntime | undefined;
  value: ModelPickerValue | null;
  selectionPolicy: ModelPickerSelectionPolicy;
  options: ModelPickerOptionsPanePropsModel;
}) => {
  const isSpeedOnly = selectionPolicy.kind === "speed_only";
  const speedOnlyReason = isSpeedOnly ? selectionPolicy.reason : null;
  const isCatalogLoading = selectedRuntime?.resource.status === "loading";
  const isCatalogReady = selectedRuntime?.resource.status === "ready";
  const supportsVariants =
    selectedRuntime?.descriptor.capabilities.optionalSurfaces.supportsVariants ?? true;
  const supportsProfiles =
    selectedRuntime?.descriptor.capabilities.optionalSurfaces.supportsProfiles ?? false;
  const supportsSpeed = selectedRuntime
    ? selectedRuntime.descriptor.capabilities.speed.support !== "none"
    : false;
  const hasConfigurableEffort =
    supportsVariants && options.effort.options.some((option) => !option.disabled);
  const effortUsesSlider =
    supportsVariants && shouldUseEffortSlider(options.effort.options, options.effort.value);
  const speedControl = options.speed?.control ?? null;
  const showsSpeedSection =
    Boolean(options.speed) &&
    supportsSpeed &&
    Boolean(
      (speedControl &&
        (speedControl.levels.length > 0 || speedControl.choice !== STANDARD_SPEED)) ||
      (isSpeedOnly && selectedRuntime && selectedRuntime.resource.status !== "ready"),
    );
  const showsProfileSection = Boolean(options.profile) && supportsProfiles;
  const showNoAdditionalOptions =
    value !== null &&
    isCatalogReady &&
    !hasConfigurableEffort &&
    !showsSpeedSection &&
    !showsProfileSection;

  return {
    isSpeedOnly,
    speedOnlyReason,
    isCatalogLoading,
    supportsVariants,
    supportsProfiles,
    supportsSpeed,
    effortUsesSlider,
    showsSpeedSection,
    showsProfileSection,
    showNoAdditionalOptions,
  };
};

export function ModelPickerOptionsPane({
  selectedRuntime,
  value,
  selectionPolicy,
  options,
}: {
  selectedRuntime: ModelPickerRuntime | undefined;
  value: ModelPickerValue | null;
  selectionPolicy: ModelPickerSelectionPolicy;
  options: ModelPickerOptionsPanePropsModel;
}): ReactElement {
  const state = resolveOptionsPaneState({ selectedRuntime, value, selectionPolicy, options });

  if (value === null) {
    return (
      <div
        aria-label="Model options"
        className="shrink-0 border-t border-border bg-muted/25 px-3.5 py-2"
      >
        <p className="text-xs text-muted-foreground">Select a model first to configure options.</p>
      </div>
    );
  }

  return (
    <div
      aria-label="Model options"
      className="flex shrink-0 flex-col gap-1 border-t border-border bg-muted/25 px-3.5 pt-1.5 pb-2.5"
    >
      <div
        className={cn(
          "grid grid-cols-1 items-start gap-x-6 gap-y-2",
          (state.showsSpeedSection || state.showsProfileSection) &&
            "@[28rem]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]",
        )}
      >
        <EffortSection
          effort={options.effort}
          supportsVariants={state.supportsVariants}
          isCatalogLoading={state.isCatalogLoading}
          lockedReason={state.speedOnlyReason}
        />
        {options.speed && state.supportsSpeed ? (
          <ModelPickerSpeedSection
            speedOptions={options.speed}
            runtime={selectedRuntime}
            isSpeedOnly={state.isSpeedOnly}
          />
        ) : null}
        {options.profile && state.supportsProfiles ? (
          <ProfileSection
            profile={options.profile}
            isCatalogLoading={state.isCatalogLoading}
            lockedReason={state.speedOnlyReason}
            alignWithTrack={state.effortUsesSlider && !state.showsSpeedSection}
          />
        ) : null}
      </div>
      {state.showNoAdditionalOptions ? (
        <p className="text-[11px] leading-snug text-muted-foreground" role="status">
          This model has no additional options.
        </p>
      ) : null}
    </div>
  );
}
