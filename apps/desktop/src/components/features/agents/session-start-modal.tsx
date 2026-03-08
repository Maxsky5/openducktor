import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { AgentRuntimeCombobox } from "@/components/features/agents/agent-runtime-combobox";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxGroup, type ComboboxOption } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  onSelectRuntime: (runtimeKind: string) => void;
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  allowRunInBackground?: boolean;
  isStarting: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onConfirm: (runInBackground: boolean) => void;
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
  const confirmDisabled = isStarting || isSelectionCatalogLoading || !selectedModelSelection;

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

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmDisabled) {
              return;
            }
            onConfirm(false);
          }}
        >
          <fieldset className="space-y-4" disabled={isStarting}>
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
                disabled={isSelectionCatalogLoading}
                className="sm:min-w-[20rem]"
                onValueChange={onSelectRuntime}
              />
            </div>

            {supportsProfiles ? (
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
                  placeholder="Select agent"
                  disabled={isSelectionCatalogLoading}
                  className="sm:min-w-[20rem]"
                  onValueChange={onSelectAgent}
                />
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="session-start-model">
                Model
              </label>
              <Combobox
                value={selectedModel}
                options={modelOptions}
                groups={modelGroups}
                placeholder={isSelectionCatalogLoading ? "Loading models..." : "Select model"}
                disabled={isSelectionCatalogLoading}
                className="sm:min-w-[28rem]"
                onValueChange={onSelectModel}
              />
            </div>

            {supportsVariants ? (
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
                  placeholder="Select variant"
                  disabled={isSelectionCatalogLoading || !selectedModelSelection}
                  className="sm:min-w-[16rem]"
                  onValueChange={onSelectVariant}
                />
              </div>
            ) : null}
          </fieldset>

          <DialogFooter className="mt-5 flex w-full items-center justify-between sm:justify-between">
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
                  onClick={() => onConfirm(true)}
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
