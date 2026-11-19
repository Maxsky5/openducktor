// The Git provider choice of git-provider-selector.tsx in
// packages/frontend/src/components/features/settings: No provider, GitHub, GitLab, and Azure
// DevOps as tiles. The selected tile has `data-selected`, and a scene moves it.
import { Check, CircleOff } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import { flag } from "../flag";
import { AzureDevOpsIcon, GithubIcon, GitlabIcon } from "./GitProviderIcons";
import "./GitProviderSelector.css";

export type GitProviderId = "none" | "github" | "gitlab" | "azure_devops";

/** The tiles of gitProviderOptions, with the labels of the provider descriptors. */
export const GIT_PROVIDER_OPTIONS = [
  { value: "none", label: "No provider" },
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "azure_devops", label: "Azure DevOps" },
] as const satisfies readonly { value: GitProviderId; label: string }[];

export const GIT_PROVIDER_TEXT = {
  legend: "Git provider",
  description: "Optional. Choose which service OpenDucktor uses for pull requests.",
} as const;

const ICONS = {
  none: CircleOff,
  github: GithubIcon,
  gitlab: GitlabIcon,
  azure_devops: AzureDevOpsIcon,
} as const satisfies Record<GitProviderId, ComponentType<{ className?: string }>>;

export function GitProviderSelector({ selected }: { selected: GitProviderId }): ReactElement {
  return (
    <div className="gps">
      <div className="gps-head">
        <b>{GIT_PROVIDER_TEXT.legend}</b>
        <p>{GIT_PROVIDER_TEXT.description}</p>
      </div>
      <div className="gps-tiles">
        {GIT_PROVIDER_OPTIONS.map(({ value, label }) => {
          const Icon = ICONS[value];
          return (
            <span
              className="gps-tile"
              data-provider={value}
              data-selected={flag(value === selected)}
              key={value}
            >
              <span className="gps-icon">
                <Icon className="i16" />
              </span>
              <span className="gps-label">{label}</span>
              <Check className="gps-check" />
            </span>
          );
        })}
      </div>
    </div>
  );
}
