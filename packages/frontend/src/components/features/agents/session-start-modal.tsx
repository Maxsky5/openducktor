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
import { sessionStartModeButtonLabel } from "@/features/session-start/session-start-display";

type SessionStartModalConfirmInput =
  | boolean
  | {
      runInBackground: boolean;
      startMode: AgentSessionStartMode;
      sourceExternalSessionId: string | null;
      targetBranch?: string;
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
  isSelectionCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  availableStartModes: AgentSessionStartMode[];
  selectedStartMode: AgentSessionStartMode;
  existingSessionOptions: ComboboxOption[];
  selectedSourceSessionId: string;
  showTargetBranchSelector?: boolean;
  targetBranchOptions?: ComboboxOption[];
  selectedTargetBranch?: string;
  onSelectStartMode: (startMode: AgentSessionStartMode) => void;
  onSelectSourceSession: (externalSessionId: string) => void;
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
    isSelectionCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    availableStartModes,
    selectedStartMode,
    existingSessionOptions,
    selectedSourceSessionId,
    showTargetBranchSelector = false,
    targetBranchOptions = [],
    selectedTargetBranch = "",
    onSelectStartMode,
    onSelectSourceSession,
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
  const hasExistingSessionSelection = existingSessionOptions.some(
    (option) => option.value === selectedSourceSessionId,
  );
  const confirmDisabled =
    isStarting ||
    (!isReuseMode &&
      (isSelectionCatalogLoading || !selectedRuntimeKind || !selectedModelSelection)) ||
    (requiresExistingSession && !hasExistingSessionSelection);
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
  const handleConfirm = (): void => {
    if (confirmDisabled) {
      return;
    }
    onConfirm({
      runInBackground: false,
      startMode: selectedStartMode,
      sourceExternalSessionId: requiresExistingSession ? selectedSourceSessionId : null,
      ...(showTargetBranchSelector ? { targetBranch: selectedTargetBranch } : {}),
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    handleConfirm();
  };

  let agentHelperText: string | null = null;
  if (isReuseMode) {
    agentHelperText = "Reuse mode keeps the previous session agent/model/variant.";
  } else if (isSelectionCatalogLoading) {
    agentHelperText = "Loading agents for the selected runtime.";
  } else if (!supportsProfiles) {
    agentHelperText = "This runtime manages agent selection automatically.";
  } else if (agentOptions.length === 0) {
    agentHelperText = "No agent profiles are available for this runtime.";
  }

  const isStartModeDisabled = (startMode: AgentSessionStartMode): boolean => {
    return (startMode === "reuse" || startMode === "fork") && !hasExistingSessionOptions;
  };

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
              {availableStartModes.length > 1 ? (
                <div className="grid gap-1.5">
                  <p className="text-sm font-medium text-foreground">Session Mode</p>
                  <div className="grid grid-cols-2 gap-2">
                    {availableStartModes.map((startMode) => (
                      <Button
                        key={startMode}
                        type="button"
                        variant={selectedStartMode === startMode ? "default" : "outline"}
                        disabled={isStartModeDisabled(startMode)}
                        onClick={() => onSelectStartMode(startMode)}
                      >
                        {sessionStartModeButtonLabel(startMode)}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              {requiresExistingSession ? (
                <div className="grid gap-1.5" data-testid="session-start-source-field">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="session-start-source"
                  >
                    Existing Session
                  </label>
                  <Combobox
                    value={selectedSourceSessionId}
                    options={existingSessionOptions}
                    placeholder="Select session"
                    searchPlaceholder="Search session..."
                    disabled={isStarting || !hasExistingSessionOptions}
                    className="sm:min-w-[28rem]"
                    onValueChange={onSelectSourceSession}
                  />
                </div>
              ) : null}

              {showTargetBranchSelector ? (
                <div className="grid gap-1.5" data-testid="session-start-target-branch-field">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="session-start-target-branch"
                  >
                    Target branch
                  </label>
                  <BranchSelector
                    value={selectedTargetBranch}
                    options={targetBranchOptions}
                    placeholder={
                      targetBranchOptions.length > 0 ? "Select branch..." : "Branches unavailable"
                    }
                    disabled={isStarting || targetBranchOptions.length === 0}
                    className="sm:min-w-[28rem]"
                    onValueChange={(branch) => onSelectTargetBranch?.(branch)}
                  />
                </div>
              ) : null}

              <div className="grid gap-1.5" data-testid="session-start-runtime-field">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="session-start-runtime"
                >
                  Agent Runtime
                </label>
                <AgentRuntimeCombobox
                  value={selectedRuntimeKind ?? ""}
                  runtimeOptions={runtimeOptions}
                  disabled={runtimeDisabled}
                  className="sm:min-w-[20rem]"
                  onValueChange={onSelectRuntime}
                />
              </div>

              <div className="grid gap-1.5" data-testid="session-start-agent-field">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="session-start-agent"
                >
                  Agent
                </label>
                <Combobox
                  value={selectedAgent}
                  options={agentOptions}
                  placeholder={supportsProfiles ? "Select agent" : "Agent handled by runtime"}
                  disabled={agentDisabled}
                  className="sm:min-w-[20rem]"
                  onValueChange={onSelectAgent}
                />
                {agentHelperText ? (
                  <p className="text-xs text-muted-foreground">{agentHelperText}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5" data-testid="session-start-model-field">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="session-start-model"
                  >
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
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="session-start-variant"
                  >
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
            </fieldset>
          </DialogBody>

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
                  onClick={() =>
                    onConfirm({
                      runInBackground: true,
                      startMode: selectedStartMode,
                      sourceExternalSessionId: requiresExistingSession
                        ? selectedSourceSessionId
                        : null,
                      ...(showTargetBranchSelector ? { targetBranch: selectedTargetBranch } : {}),
                    })
                  }
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
        </form>
      </DialogContent>
    </Dialog>
  );
}
