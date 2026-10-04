import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  GITHUB_PROVIDER_DESCRIPTOR,
} from "@openducktor/contracts";
import { Check, CircleOff, Github } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type GitProviderSelection = "none" | "github" | "azure_devops" | "unsupported";

type GitProviderSelectorProps = {
  disabled: boolean;
  selectedProviderId: GitProviderSelection;
  onSelect: (providerId: Exclude<GitProviderSelection, "unsupported">) => void;
};

export function GitProviderSelector({
  disabled,
  selectedProviderId,
  onSelect,
}: GitProviderSelectorProps): ReactElement {
  return (
    <fieldset className="grid min-w-0 gap-3 border-b border-border pb-5" disabled={disabled}>
      <legend className="text-sm font-semibold text-foreground">Git provider</legend>
      <p className="mt-1 text-xs text-muted-foreground">
        Optional. Choose which service OpenDucktor uses for pull requests.
      </p>
      <RadioGroup
        aria-label="Git provider"
        value={selectedProviderId}
        disabled={disabled}
        className="grid grid-cols-1 gap-2 md:grid-cols-3"
        onValueChange={(providerId) => {
          if (providerId === "none" || providerId === "github" || providerId === "azure_devops") {
            onSelect(providerId);
          }
        }}
      >
        {gitProviderOptions.map((option) => {
          const Icon = option.icon;
          const selected = selectedProviderId === option.value;
          return (
            <Label
              key={option.value}
              htmlFor={`git-provider-${option.value}`}
              className={cn(
                "relative flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card p-3 transition-colors hover:bg-accent/50",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40",
                selected && "border-primary shadow-sm hover:bg-card",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground",
                  selected && "border-primary bg-primary text-primary-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 pr-6">
                <span className="block truncate text-sm font-medium text-foreground">
                  {option.label}
                </span>
              </span>
              <RadioGroupItem
                id={`git-provider-${option.value}`}
                value={option.value}
                className="sr-only"
              />
              {selected ? <Check className="absolute right-3 size-4 text-primary" /> : null}
            </Label>
          );
        })}
      </RadioGroup>
      {selectedProviderId === "unsupported" ? (
        <p className="text-xs text-warning-surface-foreground">
          This repository uses a provider that this settings page cannot edit.
        </p>
      ) : null}
    </fieldset>
  );
}

function AzureDevOpsIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M0 8.899l2.247-2.966 8.405-3.416V.045l7.37 5.393L2.966 8.36v8.224L0 15.73zm24-4.45v14.652L18.247 24l-9.303-3.056V24l-5.978-7.416 15.057 1.798V5.438z" />
    </svg>
  );
}

const gitProviderOptions = [
  {
    value: "none",
    label: "No provider",
    icon: CircleOff,
  },
  {
    value: "github",
    label: GITHUB_PROVIDER_DESCRIPTOR.label,
    icon: Github,
  },
  {
    value: "azure_devops",
    label: AZURE_DEVOPS_PROVIDER_DESCRIPTOR.label,
    icon: AzureDevOpsIcon,
  },
] as const satisfies ReadonlyArray<{
  value: Exclude<GitProviderSelection, "unsupported">;
  label: string;
  icon: ComponentType<{ className?: string }>;
}>;
