import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  GITHUB_PROVIDER_DESCRIPTOR,
  GITLAB_PROVIDER_DESCRIPTOR,
} from "@openducktor/contracts";
import { Check, CircleOff, Github } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { AzureDevOpsIcon, GitlabIcon } from "./git-provider-icons";

export type GitProviderSelection = "none" | "github" | "gitlab" | "azure_devops" | "unsupported";

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
    <fieldset
      className="@container grid min-w-0 gap-3 border-b border-border pb-5"
      disabled={disabled}
    >
      <legend className="text-sm font-semibold text-foreground">Git provider</legend>
      <p className="mt-1 text-xs text-muted-foreground">
        Optional. Choose which service OpenDucktor uses for pull requests.
      </p>
      <RadioGroup
        aria-label="Git provider"
        value={selectedProviderId}
        disabled={disabled}
        // The tiles follow the width of the form, not of the window, so a label is never cut.
        className="grid grid-cols-1 gap-2 @sm:grid-cols-2 @3xl:grid-cols-4"
        onValueChange={(providerId) => {
          const option = gitProviderOptions.find((candidate) => candidate.value === providerId);
          if (option) onSelect(option.value);
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
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
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
    value: "gitlab",
    label: GITLAB_PROVIDER_DESCRIPTOR.label,
    icon: GitlabIcon,
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
