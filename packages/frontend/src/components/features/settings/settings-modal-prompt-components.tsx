import type { AgentPromptTemplateId, RepoPromptOverrides } from "@openducktor/contracts";
import { ChevronDown, CircleAlert } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PromptRoleTabId } from "./settings-modal-constants";
import { PROMPT_ROLE_TABS } from "./settings-modal-constants";
import type { PromptInheritedPreview } from "./settings-modal-normalization";

type PromptRoleTabsProps = {
  value: PromptRoleTabId;
  onChange: (next: PromptRoleTabId) => void;
  errorCounts: Record<PromptRoleTabId, number>;
  disabled: boolean;
};

export function PromptRoleTabs({
  value,
  onChange,
  errorCounts,
  disabled,
}: PromptRoleTabsProps): ReactElement {
  return (
    <div
      className="inline-flex h-9 w-full items-center bg-muted p-1"
      role="tablist"
      aria-label="Prompt role tabs"
    >
      {PROMPT_ROLE_TABS.map((entry) => {
        const tabErrorCount = errorCounts[entry.id];
        const isActive = value === entry.id;

        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={cn(
              "inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-sm px-3 text-xs transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
              disabled && "pointer-events-none opacity-50",
            )}
            onClick={() => onChange(entry.id)}
            disabled={disabled}
            title={
              tabErrorCount > 0
                ? `${tabErrorCount} prompt placeholder error${tabErrorCount > 1 ? "s" : ""}`
                : undefined
            }
          >
            <span className="inline-flex items-center gap-1.5">
              <span>{entry.label}</span>
              {tabErrorCount > 0 ? (
                <CircleAlert
                  className={cn(
                    "size-3.5 shrink-0",
                    isActive ? "text-primary-foreground" : "text-destructive-muted",
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </span>
            {tabErrorCount > 0 ? (
              <span className="sr-only">
                {tabErrorCount} prompt placeholder error{tabErrorCount > 1 ? "s" : ""}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

type PromptOverrideCardProps = {
  label: string;
  description: string;
  override?: RepoPromptOverrides[AgentPromptTemplateId] | undefined;
  inheritedPreview?: PromptInheritedPreview | undefined;
  disabled: boolean;
  canClearOverride: boolean;
  validationError?: string | undefined;
  onToggleEnabled: (next: boolean) => void;
  onTemplateChange: (nextTemplate: string) => void;
  onClearOverride: () => void;
};

export function PromptOverrideCard({
  label,
  description,
  override,
  inheritedPreview,
  disabled,
  canClearOverride,
  validationError,
  onToggleEnabled,
  onTemplateChange,
  onClearOverride,
}: PromptOverrideCardProps): ReactElement {
  const isOverrideEnabled = Boolean(override && override.enabled !== false);
  const editorValue = override?.template ?? "";
  const [isInheritedPromptExpanded, setIsInheritedPromptExpanded] = useState(false);

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-semibold text-foreground">{label}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Label className="flex shrink-0 items-center gap-2 text-xs text-foreground sm:justify-self-end">
          <Switch
            checked={isOverrideEnabled}
            onCheckedChange={onToggleEnabled}
            disabled={disabled}
          />
          Enable override
        </Label>
      </div>

      {inheritedPreview ? (
        <Collapsible
          open={isInheritedPromptExpanded}
          onOpenChange={setIsInheritedPromptExpanded}
          className="rounded-md border border-border bg-muted/60"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/80"
            >
              <p className="text-xs font-medium text-foreground">
                Inherited prompt in use: {inheritedPreview.sourceLabel}
              </p>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  isInheritedPromptExpanded ? "rotate-180" : "rotate-0",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent forceMount className="overflow-hidden data-[state=closed]:hidden">
            <div className="border-t border-border px-3 pb-3 pt-2">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-input bg-background/80 p-3 font-mono text-xs leading-relaxed text-foreground">
                {inheritedPreview.template}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <div className="grid gap-2">
        <Label className="text-xs text-foreground">Override prompt</Label>
        <Textarea
          value={editorValue}
          rows={7}
          className="font-mono text-xs"
          disabled={disabled}
          onChange={(event) => onTemplateChange(event.currentTarget.value)}
        />
        {validationError ? (
          <p className="text-xs text-destructive-muted">{validationError}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !canClearOverride}
          onClick={onClearOverride}
        >
          Clear override
        </Button>
      </div>
    </div>
  );
}
