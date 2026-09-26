import type { RuntimeDescriptor, SettingsRepoConfig } from "@openducktor/contracts";
import type { ReactElement } from "react";
import {
  ROLE_DEFAULTS,
  resolveRepoAgentDefaultRuntimeKind,
  type ModelDefaultsValue,
} from "@/components/features/repository/model-defaults/model-defaults-model";
import {
  RepositoryModelDefaultsFields,
  type RepositoryModelDefaultsFieldsProps,
} from "@/components/features/repository/model-defaults/repository-model-defaults-fields";
import { findRuntimeDefinition } from "@/lib/agent-runtime";

type RepositoryAgentsSectionProps = Omit<
  RepositoryModelDefaultsFieldsProps,
  "selectedRepoConfig" | "onUpdateSelectedRepoConfig"
> & {
  selectedRepoConfig: SettingsRepoConfig | null;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
};

const findMissingRoleLabels = ({
  selectedRepoConfig,
  runtimeDefinitions,
}: {
  selectedRepoConfig: ModelDefaultsValue;
  runtimeDefinitions: RuntimeDescriptor[];
}): string[] =>
  ROLE_DEFAULTS.reduce<string[]>((labels, { role, label }) => {
    const value = selectedRepoConfig.agentDefaults[role];
    const runtimeKind = resolveRepoAgentDefaultRuntimeKind({
      selectedRepoConfig,
      runtimeDefinitions,
      role,
    });
    const runtimeDefinition = runtimeKind
      ? findRuntimeDefinition(runtimeDefinitions, runtimeKind)
      : null;
    const hasCompleteDefault = Boolean(
      value &&
      runtimeDefinition &&
      value.providerId.trim().length > 0 &&
      value.modelId.trim().length > 0 &&
      (!runtimeDefinition.capabilities.optionalSurfaces.supportsProfiles ||
        (value.profileId?.trim().length ?? 0) > 0),
    );

    if (!hasCompleteDefault) {
      labels.push(label);
    }

    return labels;
  }, []);

export function RepositoryAgentsSection(props: RepositoryAgentsSectionProps): ReactElement {
  const selectedRepoConfig = props.selectedRepoConfig;
  if (!selectedRepoConfig) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground">
        Select a repository to edit agent defaults.
      </div>
    );
  }
  const missingRoleLabels = findMissingRoleLabels({
    selectedRepoConfig,
    runtimeDefinitions: props.availableRuntimeDefinitions,
  });
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
      roleNotice={
        missingRoleLabels.length > 0 ? (
          <p className="text-xs text-warning-muted">
            Missing complete defaults for: {missingRoleLabels.join(", ")}.
          </p>
        ) : null
      }
    />
  );
}
