import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import { LoaderCircle } from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import { AgentRuntimeCombobox } from "@/components/features/agents/agent-runtime-combobox";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxGroup, type ComboboxOption } from "@/components/ui/combobox";
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
import { sessionStartModeButtonLabel } from "@/features/session-start/session-start-display";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

type SessionStartModalConfirmInput =
  | boolean
  | {
      runInBackground: boolean;
      startMode: AgentSessionStartMode;
      sourceSessionOptionValue: string | null;
      targetBranch?: string;
    };
type SessionStartModalConfirmPayload = Exclude<SessionStartModalConfirmInput, boolean>;
type SessionStartModalConfirmDraft = Omit<SessionStartModalConfirmPayload, "runInBackground">;

type ExistingSessionOption = ComboboxOption & {
  sourceSession: AgentSessionIdentity;
};

export type SessionStartModalModel = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  backgroundConfirmLabel?: string;
  cancelLabel?: string;
  selectedModelSelection: AgentModelSelection | null;
  selectedRuntimeKind: RuntimeKind | null;
  runtimeOptions: ComboboxOption[];
  supportsProfiles: boolean;
  supportsVariants: boolean;
  selectionCatalogError: string | null;
  isSelectionCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  availableStartModes: AgentSessionStartMode[];
  selectedStartMode: AgentSessionStartMode;
  existingSessionOptions: ExistingSessionOption[];
  selectedSourceSessionValue: string;
  showTargetBranchSelector?: boolean;
  targetBranchOptions?: ComboboxOption[];
  selectedTargetBranch?: string;
  onSelectStartMode: (startMode: AgentSessionStartMode) => void;
  onSelectSourceSessionValue: (sourceSessionValue: string) => void;
  onSelectTargetBranch?: (branch: string) => void;
  onSelectRuntime: (runtimeKind: RuntimeKind) => void;
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  allowRunInBackground?: boolean;
  isStarting: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onConfirm: (input?: SessionStartModalConfirmInput) => void;
};

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

  const isStartModeDisabled = (startMode: AgentSessionStartMode): boolean => {
    return (startMode === "reuse" || startMode === "fork") && !hasExistingSessionOptions;
  };

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
  existingSessionOptions: ExistingSessionOption[];
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
  selectedTargetBranch: string;
  targetBranchOptions: ComboboxOption[];
  onSelectTargetBranch: ((branch: string) => void) | undefined;
};

function TargetBranchField({
  disabled,
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
        placeholder={targetBranchOptions.length > 0 ? "Select branch..." : "Branches unavailable"}
        disabled={disabled}
        className="sm:min-w-[28rem]"
        onValueChange={(branch) => onSelectTargetBranch?.(branch)}
      />
    </div>
  );
}

type RuntimeFieldProps = {
  disabled: boolean;
  runtimeOptions: ComboboxOption[];
  selectedRuntimeKind: RuntimeKind | null;
  selectedStartMode: AgentSessionStartMode;
  onSelectRuntime: (runtimeKind: RuntimeKind) => void;
};

function RuntimeField({
  disabled,
  runtimeOptions,
  selectedRuntimeKind,
  selectedStartMode,
  onSelectRuntime,
}: RuntimeFieldProps): ReactElement {
  const runtimePlaceholder =
    runtimeOptions.length > 0
      ? "Select runtime"
      : `No runtime supports ${sessionStartModeButtonLabel(selectedStartMode).toLowerCase()}`;

  return (
    <div className="grid gap-1.5" data-testid="session-start-runtime-field">
      <label className="text-sm font-medium text-foreground" htmlFor="session-start-runtime">
        Agent Runtime
      </label>
      <AgentRuntimeCombobox
        value={selectedRuntimeKind ?? ""}
        runtimeOptions={runtimeOptions}
        placeholder={runtimePlaceholder}
        disabled={disabled}
        className="sm:min-w-[20rem]"
        onValueChange={onSelectRuntime}
      />
    </div>
  );
}

type AgentFieldProps = {
  agentOptions: ComboboxOption[];
  disabled: boolean;
  helperText: string | null;
  selectedAgent: string;
  supportsProfiles: boolean;
  onSelectAgent: (agent: string) => void;
};

function AgentField({
  agentOptions,
  disabled,
  helperText,
  selectedAgent,
  supportsProfiles,
  onSelectAgent,
}: AgentFieldProps): ReactElement {
  return (
    <div className="grid gap-1.5" data-testid="session-start-agent-field">
      <label className="text-sm font-medium text-foreground" htmlFor="session-start-agent">
        Agent
      </label>
      <Combobox
        value={selectedAgent}
        options={agentOptions}
        placeholder={supportsProfiles ? "Select agent" : "Agent handled by runtime"}
        disabled={disabled}
        className="sm:min-w-[20rem]"
        onValueChange={onSelectAgent}
      />
      {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
    </div>
  );
}

type ModelVariantFieldsProps = {
  catalogError: string | null;
  isSelectionCatalogLoading: boolean;
  modelDisabled: boolean;
  modelGroups: ComboboxGroup[];
  modelOptions: ComboboxOption[];
  selectedModel: string;
  selectedModelSelection: AgentModelSelection | null;
  selectedVariant: string;
  supportsVariants: boolean;
  variantDisabled: boolean;
  variantOptions: ComboboxOption[];
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
};

function ModelVariantFields({
  catalogError,
  isSelectionCatalogLoading,
  modelDisabled,
  modelGroups,
  modelOptions,
  selectedModel,
  selectedModelSelection,
  selectedVariant,
  supportsVariants,
  variantDisabled,
  variantOptions,
  onSelectModel,
  onSelectVariant,
}: ModelVariantFieldsProps): ReactElement {
  return (
    <div className="grid gap-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5" data-testid="session-start-model-field">
          <label className="text-sm font-medium text-foreground" htmlFor="session-start-model">
            Model
          </label>
          <Combobox
            value={selectedModel}
            options={modelOptions}
            groups={modelGroups}
            matchAllSearchTerms
            placeholder={isSelectionCatalogLoading ? "Loading models..." : "Select model"}
            disabled={modelDisabled}
            className="w-full"
            onValueChange={onSelectModel}
          />
        </div>

        <div className="grid gap-1.5" data-testid="session-start-variant-field">
          <label className="text-sm font-medium text-foreground" htmlFor="session-start-variant">
            Variant
          </label>
          <Combobox
            value={selectedVariant}
            options={variantOptions}
            placeholder={
              isSelectionCatalogLoading
                ? "Checking compatibility..."
                : !selectedModelSelection
                  ? "Select model first"
                  : !supportsVariants
                    ? "Variants handled by runtime"
                    : variantOptions.length === 0
                      ? "This model has no variants"
                      : "Select variant"
            }
            disabled={variantDisabled}
            className="w-full"
            onValueChange={onSelectVariant}
          />
        </div>
      </div>
      {catalogError ? (
        <p className="text-xs text-destructive" role="alert">
          Failed to load runtime catalog: {catalogError}
        </p>
      ) : null}
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

const agentHelperTextFor = ({
  agentOptions,
  isReuseMode,
  isSelectionCatalogLoading,
  supportsProfiles,
}: {
  agentOptions: ComboboxOption[];
  isReuseMode: boolean;
  isSelectionCatalogLoading: boolean;
  supportsProfiles: boolean;
}): string | null => {
  if (isReuseMode) {
    return "Reuse mode keeps the previous session agent/model/variant.";
  }
  if (isSelectionCatalogLoading) {
    return "Loading agents for the selected runtime.";
  }
  if (!supportsProfiles) {
    return "This runtime manages agent selection automatically.";
  }
  if (agentOptions.length === 0) {
    return "No agent profiles are available for this runtime.";
  }
  return null;
};

export function SessionStartModal({ model }: { model: SessionStartModalModel }): ReactElement {
  const {
    open,
    title,
    description,
    confirmLabel,
    backgroundConfirmLabel = "Run in background",
    cancelLabel = "Cancel",
    selectedModelSelection,
    selectedRuntimeKind,
    runtimeOptions,
    supportsProfiles,
    supportsVariants,
    selectionCatalogError,
    isSelectionCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
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
    onSelectRuntime,
    onSelectAgent,
    onSelectModel,
    onSelectVariant,
    allowRunInBackground = false,
    isStarting,
    onOpenChange,
    onConfirm,
  } = model;

  const selectedAgent = selectedModelSelection?.profileId ?? "";
  const selectedModel = selectedModelSelection
    ? `${selectedModelSelection.providerId}/${selectedModelSelection.modelId}`
    : "";
  const selectedVariant = selectedModelSelection?.variant ?? "";
  const hasExistingSessionOptions = existingSessionOptions.length > 0;
  const isReuseMode = selectedStartMode === "reuse";
  const requiresExistingSession = selectedStartMode === "reuse" || selectedStartMode === "fork";
  const selectedSourceSessionOption = existingSessionOptions.find(
    (option) => option.value === selectedSourceSessionValue,
  );
  const hasExistingSessionSelection = selectedSourceSessionOption !== undefined;
  const confirmDisabled =
    isStarting ||
    (!isReuseMode && selectionCatalogError !== null) ||
    (!isReuseMode &&
      (isSelectionCatalogLoading || !selectedRuntimeKind || !selectedModelSelection)) ||
    (requiresExistingSession && !hasExistingSessionSelection);
  const confirmInput = {
    startMode: selectedStartMode,
    sourceSessionOptionValue: requiresExistingSession ? selectedSourceSessionValue : null,
    ...(showTargetBranchSelector ? { targetBranch: selectedTargetBranch } : {}),
  };
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

  const runtimeDisabled = isSelectionCatalogLoading || isReuseMode;
  const agentDisabled =
    isReuseMode || isSelectionCatalogLoading || !supportsProfiles || agentOptions.length === 0;
  const modelDisabled = isReuseMode || isSelectionCatalogLoading;
  const variantDisabled =
    isReuseMode ||
    isSelectionCatalogLoading ||
    !selectedModelSelection ||
    !supportsVariants ||
    variantOptions.length === 0;
  const agentHelperText = agentHelperTextFor({
    agentOptions,
    isReuseMode,
    isSelectionCatalogLoading,
    supportsProfiles,
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

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
                  selectedTargetBranch={selectedTargetBranch}
                  targetBranchOptions={targetBranchOptions}
                  onSelectTargetBranch={onSelectTargetBranch}
                />
              ) : null}

              <RuntimeField
                disabled={runtimeDisabled}
                runtimeOptions={runtimeOptions}
                selectedRuntimeKind={selectedRuntimeKind}
                selectedStartMode={selectedStartMode}
                onSelectRuntime={onSelectRuntime}
              />

              {supportsProfiles ? (
                <AgentField
                  agentOptions={agentOptions}
                  disabled={agentDisabled}
                  helperText={agentHelperText}
                  selectedAgent={selectedAgent}
                  supportsProfiles={supportsProfiles}
                  onSelectAgent={onSelectAgent}
                />
              ) : null}

              <ModelVariantFields
                catalogError={selectionCatalogError}
                isSelectionCatalogLoading={isSelectionCatalogLoading}
                modelDisabled={modelDisabled}
                modelGroups={modelGroups}
                modelOptions={modelOptions}
                selectedModel={selectedModel}
                selectedModelSelection={selectedModelSelection}
                selectedVariant={selectedVariant}
                supportsVariants={supportsVariants}
                variantDisabled={variantDisabled}
                variantOptions={variantOptions}
                onSelectModel={onSelectModel}
                onSelectVariant={onSelectVariant}
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
      </DialogContent>
    </Dialog>
  );
}
