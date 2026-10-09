import type { SettingsRepoConfig } from "@openducktor/contracts";
import type { ReactElement } from "react";
import {
  RepositoryModelDefaultsFields,
  type RepositoryModelDefaultsFieldsProps,
} from "@/components/features/repository/model-defaults/repository-model-defaults-fields";

type RepositoryAgentsSectionProps = Omit<
  RepositoryModelDefaultsFieldsProps,
  "selectedRepoConfig" | "onUpdateSelectedRepoConfig"
> & {
  selectedRepoConfig: SettingsRepoConfig | null;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
};

export function RepositoryAgentsSection(props: RepositoryAgentsSectionProps): ReactElement {
  const selectedRepoConfig = props.selectedRepoConfig;
  if (!selectedRepoConfig) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
        Select a repository to edit agent defaults.
      </div>
    );
  }
  return (
    <RepositoryModelDefaultsFields
      {...props}
      selectedRepoConfig={selectedRepoConfig}
      onUpdateSelectedRepoConfig={(updater) =>
        props.onUpdateSelectedRepoConfig((current) => ({
          ...current,
          ...updater(current),
        }))
      }
    />
  );
}
