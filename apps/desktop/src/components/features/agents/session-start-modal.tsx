import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentSessionStartMode } from "@openducktor/core";
import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { AgentRuntimeCombobox } from "@/components/features/agents/agent-runtime-combobox";
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

type SessionStartModalConfirmInput =
  | boolean
  | {
      runInBackground: boolean;
      startMode: AgentSessionStartMode;
      sourceSessionId: string | null;
    };

export type SessionStartModalModel = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  backgroundConfirmLabel?: string;
  cancelLabel?: string;
  selectedModelSelection: AgentModelSelection | null;
  selectedRuntimeKind: RuntimeKind;
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
  onSelectStartMode: (startMode: AgentSessionStartMode) => void;
  onSelectSourceSession: (sessionId: string) => void;
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
    onSelectStartMode,
    onSelectSourceSession,
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
    (!isReuseMode && (isSelectionCatalogLoading || !selectedModelSelection)) ||
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
      sourceSessionId: requiresExistingSession ? selectedSourceSessionId : null,
    });
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

        <form className="flex min-h-0 flex-1 flex-col" action={handleConfirm}>
          <DialogBody className="pt-2 pb-4">
            <fieldset className="space-y-5" disabled={isStarting}>
              {availableStartModes.length > 1 ? (
                <div className="grid gap-1.5">
                  <p className="text-sm font-medium text-foreground">Session Mode</p>
                  <div className="grid grid-cols-2 gap-2">
                    {availableStartModes.includes("fresh") ? (
                      <Button
                        type="button"
                        variant={selectedStartMode === "fresh" ? "default" : "outline"}
                        onClick={() => onSelectStartMode("fresh")}
                      >
                        Start fresh
                      </Button>
                    ) : null}
                    {availableStartModes.includes("reuse") ? (
                      <Button
                        type="button"
                        variant={selectedStartMode === "reuse" ? "default" : "outline"}
                        disabled={!hasExistingSessionOptions}
                        onClick={() => onSelectStartMode("reuse")}
                      >
                        Reuse existing
                      </Button>
                    ) : null}
                    {availableStartModes.includes("fork") ? (
                      <Button
                        type="button"
                        variant={selectedStartMode === "fork" ? "default" : "outline"}
                        disabled={!hasExistingSessionOptions}
                        onClick={() => onSelectStartMode("fork")}
                      >
                        Fork existing
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {requiresExistingSession ? (
                <div className="grid gap-1.5">
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

              <div className="grid gap-1.5">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="session-start-runtime"
                >
                  Agent Runtime
                </label>
                <AgentRuntimeCombobox
                  value={selectedRuntimeKind}
                  runtimeOptions={runtimeOptions}
                  disabled={runtimeDisabled}
                  className="sm:min-w-[20rem]"
                  onValueChange={onSelectRuntime}
                />
              </div>

              <div className="grid gap-1.5">
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
                <div className="grid gap-1.5">
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
                    placeholder={isSelectionCatalogLoading ? "Loading models..." : "Select model"}
                    disabled={modelDisabled}
                    className="w-full"
                    onValueChange={onSelectModel}
                  />
                </div>

                <div className="grid gap-1.5">
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
                      sourceSessionId: requiresExistingSession ? selectedSourceSessionId : null,
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
