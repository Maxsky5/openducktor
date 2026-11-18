import type { ReactElement } from "react";
import type { WorkspaceModelDefaultsDraft } from "@/types/state-slices";
import {
  RepositoryModelBlock,
  type RepositoryModelBlockProps,
  selectPickedModel,
} from "./repository-model-block";

type RepositoryNamingModelBlockProps = Pick<
  RepositoryModelBlockProps,
  | "catalogResources"
  | "favoriteState"
  | "loadingState"
  | "getCatalogForRuntime"
  | "isCatalogLoadingForRuntime"
> & {
  selectedRepoConfig: WorkspaceModelDefaultsDraft;
  availableRuntimeDefinitions: RepositoryModelBlockProps["runtimeDefinitions"];
  onUpdateSelectedRepoConfig: (
    updater: (current: WorkspaceModelDefaultsDraft) => WorkspaceModelDefaultsDraft,
  ) => void;
};

/** The model that writes short session titles and branch names. It has no agent profile. */
export function RepositoryNamingModelBlock({
  selectedRepoConfig,
  availableRuntimeDefinitions,
  onUpdateSelectedRepoConfig,
  ...block
}: RepositoryNamingModelBlockProps): ReactElement {
  return (
    <RepositoryModelBlock
      {...block}
      title="Naming model"
      description="Writes short session titles and branch names. Leave empty to keep the current names."
      presentation="settings"
      showProfile={false}
      value={selectedRepoConfig.namingModel ?? null}
      runtimeDefinitions={availableRuntimeDefinitions}
      onSelectModel={(value, targetCatalog) =>
        onUpdateSelectedRepoConfig((repoConfig) => {
          const next = selectPickedModel(repoConfig.namingModel, value, targetCatalog);
          if (!next) return repoConfig;
          const { runtimeKind, providerId, modelId, variant } = next;
          return { ...repoConfig, namingModel: { runtimeKind, providerId, modelId, variant } };
        })
      }
      onUpdateField={(field, value) =>
        onUpdateSelectedRepoConfig((repoConfig) =>
          field === "variant" && repoConfig.namingModel
            ? { ...repoConfig, namingModel: { ...repoConfig.namingModel, variant: value } }
            : repoConfig,
        )
      }
      onClear={() =>
        onUpdateSelectedRepoConfig((repoConfig) => ({ ...repoConfig, namingModel: undefined }))
      }
    />
  );
}
