import { SessionStartKickoffField } from "./session-start-kickoff-field";
import { SpeedSelect } from "./speed-select";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import { LoaderCircle } from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import { ModelPicker } from "@/components/features/agents/model-picker";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import {
  isSessionStartModeUnavailable,
  sessionStartModeButtonLabel,
  sessionStartModelPlaceholder,
  sessionStartModelReadOnlyReason,
  sessionStartRuntimeProfileHelperText,
  sessionStartTargetBranchPlaceholder,
  sessionStartVariantPlaceholder,
} from "@openducktor/frontend-core/sessions/start/session-start-display";
import {
  buildSessionStartConfirmDraft,
  resolveSessionStartAvailability,
  type SessionStartModalConfirmDraft,
  type SessionStartModalConfirmInput,
  type SessionStartModalModel,
  type SessionStartSourceOption,
} from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import { useSessionStartKickoffDraft } from "@openducktor/frontend-core/sessions/start/use-session-start-kickoff-draft";
import { useSessionStartSpeed } from "@openducktor/frontend-core/sessions/start/use-session-start-speed";
import { SessionStartupProgressContent } from "@/features/session-startup/session-startup-dialog-progress";

type StartModeFieldProps = {
  availableStartModes: AgentSessionStartMode[];
  hasExistingSessionOptions: boolean;
  selectedStartMode: AgentSessionStartMode;
  onSelectStartMode: (startMode: AgentSessionStartMode) => void;
};

function StartModeField({
  availableStartModes,
  hasExistingSessionOptions,
  selectedStartMode,
  onSelectStartMode,
}: StartModeFieldProps): ReactElement | null {
  if (availableStartModes.length <= 1) {
    return null;
  }

  const isStartModeDisabled = (startMode: AgentSessionStartMode): boolean =>
    isSessionStartModeUnavailable(startMode, hasExistingSessionOptions);

  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium text-foreground">Session Mode</p>
      <SegmentedControlRoot size="lg" className="w-full" aria-label="Session mode">
        {availableStartModes.map((startMode) => {
          const isSelected = selectedStartMode === startMode;
          return (
            <SegmentedControlItem
              key={startMode}
              active={isSelected}
              size="lg"
              disabled={isStartModeDisabled(startMode)}
              onClick={() => onSelectStartMode(startMode)}
            >
              {sessionStartModeButtonLabel(startMode)}
            </SegmentedControlItem>
          );
        })}
      </SegmentedControlRoot>
    </div>
  );
}

type ExistingSessionFieldProps = {
  disabled: boolean;
  existingSessionOptions: SessionStartSourceOption[];
  selectedSourceSessionValue: string;
  onSelectSourceSessionValue: (sourceSessionValue: string) => void;
};

function ExistingSessionField({
  disabled,
  existingSessionOptions,
  selectedSourceSessionValue,
  onSelectSourceSessionValue,
}: ExistingSessionFieldProps): ReactElement {
  return (
    <div className="grid gap-1.5" data-testid="session-start-source-field">
      <label className="text-sm font-medium text-foreground" htmlFor="session-start-source">
        Existing Session
      </label>
      <Combobox
        value={selectedSourceSessionValue}
        options={existingSessionOptions}
        placeholder="Select session"
        searchPlaceholder="Search session..."
        disabled={disabled}
        className="sm:min-w-[28rem]"
        onValueChange={onSelectSourceSessionValue}
      />
    </div>
  );
}

type TargetBranchFieldProps = {
  disabled: boolean;
  /** Why the start cannot use the configured target branch, or null. */
  error: string | null;
  selectedTargetBranch: string;
  targetBranchOptions: ComboboxOption[];
  onSelectTargetBranch: ((branch: string) => void) | undefined;
};

function TargetBranchField({
  disabled,
  error,
  selectedTargetBranch,
  targetBranchOptions,
  onSelectTargetBranch,
}: TargetBranchFieldProps): ReactElement {
  return (
    <div className="grid gap-1.5" data-testid="session-start-target-branch-field">
      <label className="text-sm font-medium text-foreground" htmlFor="session-start-target-branch">
        Target branch
      </label>
      <BranchSelector
        value={selectedTargetBranch}
        options={targetBranchOptions}
        placeholder={sessionStartTargetBranchPlaceholder(targetBranchOptions.length)}
        disabled={disabled}
        className="sm:min-w-[28rem]"
        onValueChange={(branch) => onSelectTargetBranch?.(branch)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type RuntimeProfileFieldProps = {
  runtimeProfileOptions: ComboboxOption[];
  disabled: boolean;
  helperText: string | null;
  selectedProfileId: string;
  onSelectRuntimeProfile: (profileId: string) => void;
};

function RuntimeProfileField({
  runtimeProfileOptions,
  disabled,
  helperText,
  selectedProfileId,
  onSelectRuntimeProfile,
}: RuntimeProfileFieldProps): ReactElement {
  return (
    <div className="grid gap-1.5" data-testid="session-start-runtime-profile-field">
      <label
        className="text-sm font-medium text-foreground"
        htmlFor="session-start-runtime-profile"
      >
        Runtime profile
      </label>
      <Combobox
        value={selectedProfileId}
        options={runtimeProfileOptions}
        placeholder="Select runtime profile"
        disabled={disabled}
        className="sm:min-w-[20rem]"
        onValueChange={onSelectRuntimeProfile}
      />
      {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
    </div>
  );
}

type ModelVariantFieldsProps = {
  speed: SpeedControlModel | null;
  isSelectionCatalogLoading: boolean;
  selectedModelSelection: AgentModelSelection | null;
  selectedVariant: string;
  supportsVariants: boolean;
  variantDisabled: boolean;
  variantOptions: ComboboxOption[];
  onSelectVariant: (variant: string) => void;
};

function ModelVariantFields({
  speed,
  isSelectionCatalogLoading,
  selectedModelSelection,
  selectedVariant,
  supportsVariants,
  variantDisabled,
  variantOptions,
  onSelectVariant,
}: ModelVariantFieldsProps): ReactElement {
  return (
    <div className="flex items-end gap-2" data-testid="session-start-variant-field">
      <div className="grid min-w-0 flex-1 gap-1.5">
        <p className="text-sm font-medium text-foreground" id="session-start-variant-label">
          Effort
        </p>
        <Combobox
          triggerAriaLabelledBy="session-start-variant-label"
          value={selectedVariant}
          options={variantOptions}
          placeholder={sessionStartVariantPlaceholder({
            isSelectionCatalogLoading,
            hasSelectedModel: selectedModelSelection !== null,
            supportsVariants,
            variantCount: variantOptions.length,
          })}
          disabled={variantDisabled}
          className="w-full"
          onValueChange={onSelectVariant}
        />
      </div>
      <SpeedSelect key={speed?.key} model={speed} label="Speed" />
    </div>
  );
}

type SessionStartModalFooterProps = {
  allowRunInBackground: boolean;
  backgroundConfirmLabel: string;
  cancelLabel: string;
  confirmDisabled: boolean;
  confirmLabel: string;
  confirmInput: SessionStartModalConfirmDraft;
  isStarting: boolean;
  onConfirm: (input?: SessionStartModalConfirmInput) => void;
  onOpenChange: (nextOpen: boolean) => void;
};

function SessionStartModalFooter({
  allowRunInBackground,
  backgroundConfirmLabel,
  cancelLabel,
  confirmDisabled,
  confirmLabel,
  confirmInput,
  isStarting,
  onConfirm,
  onOpenChange,
}: SessionStartModalFooterProps): ReactElement {
  return (
    <DialogFooter className="mt-0 flex w-full items-center justify-between border-t border-border pt-5 sm:justify-between">
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={isStarting}
      >
        {cancelLabel}
      </Button>

      <div className="flex items-center gap-2">
        {allowRunInBackground ? (
          <Button
            type="button"
            variant="secondary"
            disabled={confirmDisabled}
            onClick={() => onConfirm({ ...confirmInput, runInBackground: true })}
          >
            {isStarting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {backgroundConfirmLabel}
          </Button>
        ) : null}
        <Button type="submit" disabled={confirmDisabled}>
          {isStarting ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {confirmLabel}
        </Button>
      </div>
    </DialogFooter>
  );
}

function SessionStartModelPicker({ model }: { model: SessionStartModalModel }): ReactElement {
  const {
    selectedModelSelection,
    selectedStartMode,
    isStarting,
    modelPickerRuntimes,
    favoriteState,
    runtimeDefinitionsError,
    isRuntimeDefinitionsLoading,
    onRetryRuntimeDefinitions,
    hasRuntimeSettingsSnapshot,
    runtimeSettingsError,
    isRuntimeSettingsLoading,
    onRetryRuntimeSettings,
    isSelectionCatalogLoading,
    onSelectModelPair,
  } = model;
  const isReuseMode = selectedStartMode === "reuse";
  const selectedPickerValue =
    selectedModelSelection?.runtimeKind && selectedModelSelection.providerId
      ? {
          runtimeKind: selectedModelSelection.runtimeKind,
          providerId: selectedModelSelection.providerId,
          modelId: selectedModelSelection.modelId,
        }
      : null;
  const modelReadOnlyReason = sessionStartModelReadOnlyReason(isStarting);
  if (runtimeDefinitionsError) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
        role="alert"
      >
        <span className="min-w-0 text-destructive">
          Runtime definitions unavailable: {runtimeDefinitionsError}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onRetryRuntimeDefinitions}>
          Retry
        </Button>
      </div>
    );
  }
  if (isRuntimeDefinitionsLoading) {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Loading agent runtimes...
      </div>
    );
  }
  if (!hasRuntimeSettingsSnapshot && runtimeSettingsError) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
        role="alert"
      >
        <span className="min-w-0 text-destructive">
          Runtime settings unavailable: {runtimeSettingsError}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onRetryRuntimeSettings}>
          Retry
        </Button>
      </div>
    );
  }
  if (!hasRuntimeSettingsSnapshot && isRuntimeSettingsLoading) {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Loading runtime settings...
      </div>
    );
  }
  return (
    <ModelPicker
      runtimes={modelPickerRuntimes}
      value={selectedPickerValue}
      favoriteState={favoriteState}
      selectionPolicy={
        isReuseMode || isStarting
          ? {
              kind: "read_only",
              reason: modelReadOnlyReason,
            }
          : { kind: "editable" }
      }
      placeholder={sessionStartModelPlaceholder(isSelectionCatalogLoading)}
      triggerClassName="w-full justify-between"
      onValueChange={onSelectModelPair}
    />
  );
}

export function SessionStartModal({ model }: { model: SessionStartModalModel }): ReactElement {
  const {
    open,
    title,
    description,
    confirmLabel,
    backgroundConfirmLabel = "Run in background",
    cancelLabel = "Cancel",
    selectedModelSelection,
    supportsProfiles,
    supportsVariants,
    isSelectionCatalogLoading,
    runtimeProfileOptions,
    variantOptions,
    availableStartModes,
    selectedStartMode,
    existingSessionOptions,
    selectedSourceSessionValue,
    showTargetBranchSelector = false,
    targetBranchOptions = [],
    selectedTargetBranch = "",
    onSelectStartMode,
    onSelectSourceSessionValue,
    onSelectTargetBranch,
    onSelectRuntimeProfile,
    onSelectVariant,
    allowRunInBackground = false,
    isStarting,
    onOpenChange,
    onConfirm,
  } = model;

  const kickoffDraft = useSessionStartKickoffDraft({
    requestId: model.requestId,
    open,
    prompt: model.kickoffPrompt,
  });

  const { control: speed, change: speedChange } = useSessionStartSpeed(model);
  const selectedProfileId = selectedModelSelection?.profileId ?? "";
  const selectedVariant = selectedModelSelection?.variant ?? "";
  const availability = resolveSessionStartAvailability(model, {
    kickoffInvalid: kickoffDraft.invalid,
  });
  const {
    hasExistingSessionOptions,
    isReuseMode,
    requiresExistingSession,
    runtimeProfileDisabled,
    variantDisabled,
  } = availability;
  const { confirmDisabled } = availability;
  const confirmInput = buildSessionStartConfirmDraft({
    model,
    requiresExistingSession,
    speedChange,
    kickoffPrompt: kickoffDraft.value,
  });
  const handleConfirm = (): void => {
    if (confirmDisabled) {
      return;
    }
    onConfirm({ ...confirmInput, runInBackground: false });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    handleConfirm();
  };

  const runtimeProfileHelperText = sessionStartRuntimeProfileHelperText({
    runtimeProfileCount: runtimeProfileOptions.length,
    isReuseMode,
    isSelectionCatalogLoading,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isStarting) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className={
          model.phase.kind === "progress"
            ? "h-[min(36rem,calc(100dvh-2rem))] sm:max-w-2xl"
            : "sm:max-w-2xl"
        }
        closeButton={isStarting ? null : undefined}
        onEscapeKeyDown={(event) => {
          if (isStarting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isStarting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {model.phase.kind === "progress" ? (
          <SessionStartupProgressContent
            open={open}
            startupAttemptId={model.phase.startupAttemptId}
            onClose={() => onOpenChange(false)}
            onContinueInBackground={model.onContinueInBackground}
            onEditChoices={model.onEditChoices}
          />
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
            <DialogBody className="pt-2 pb-4">
              <fieldset className="space-y-5" disabled={isStarting}>
                <StartModeField
                  availableStartModes={availableStartModes}
                  hasExistingSessionOptions={hasExistingSessionOptions}
                  selectedStartMode={selectedStartMode}
                  onSelectStartMode={onSelectStartMode}
                />

                {requiresExistingSession ? (
                  <ExistingSessionField
                    disabled={isStarting || !hasExistingSessionOptions}
                    existingSessionOptions={existingSessionOptions}
                    selectedSourceSessionValue={selectedSourceSessionValue}
                    onSelectSourceSessionValue={onSelectSourceSessionValue}
                  />
                ) : null}

                {showTargetBranchSelector ? (
                  <TargetBranchField
                    disabled={isStarting || targetBranchOptions.length === 0}
                    error={model.targetBranchError ?? null}
                    selectedTargetBranch={selectedTargetBranch}
                    targetBranchOptions={targetBranchOptions}
                    onSelectTargetBranch={onSelectTargetBranch}
                  />
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5" data-testid="session-start-model-picker-field">
                    <p className="text-sm font-medium text-foreground">Runtime and model</p>
                    <SessionStartModelPicker model={model} />
                  </div>
                  <ModelVariantFields
                    speed={speed}
                    isSelectionCatalogLoading={isSelectionCatalogLoading}
                    selectedModelSelection={selectedModelSelection}
                    selectedVariant={selectedVariant}
                    supportsVariants={supportsVariants}
                    variantDisabled={variantDisabled}
                    variantOptions={variantOptions}
                    onSelectVariant={onSelectVariant}
                  />
                </div>

                {supportsProfiles ? (
                  <RuntimeProfileField
                    runtimeProfileOptions={runtimeProfileOptions}
                    disabled={runtimeProfileDisabled}
                    helperText={runtimeProfileHelperText}
                    selectedProfileId={selectedProfileId}
                    onSelectRuntimeProfile={onSelectRuntimeProfile}
                  />
                ) : null}

                <SessionStartKickoffField
                  draft={kickoffDraft}
                  disabled={isStarting}
                  loading={model.isKickoffPromptLoading}
                  error={model.kickoffPromptError}
                  onRetry={model.onRetryKickoffPrompt}
                />
              </fieldset>
            </DialogBody>

            <SessionStartModalFooter
              allowRunInBackground={allowRunInBackground}
              backgroundConfirmLabel={backgroundConfirmLabel}
              cancelLabel={cancelLabel}
              confirmDisabled={confirmDisabled}
              confirmLabel={confirmLabel}
              confirmInput={confirmInput}
              isStarting={isStarting}
              onConfirm={onConfirm}
              onOpenChange={onOpenChange}
            />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
