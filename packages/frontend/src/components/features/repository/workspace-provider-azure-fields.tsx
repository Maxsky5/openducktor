import { useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ManagedConnection } from "../settings/azure-devops-connection-settings";
import { ManualRepositoryForm } from "../settings/azure-devops-repository-settings";
import {
  azureRepositoryDraftErrors,
  azureRemoteMappingDraftListErrors,
  parseAzureRepositoryDraft,
  azureDevOpsHttpConsentCollectionUrl,
  type AzureRepositoryDraftField,
} from "../settings/azure-devops-git-provider-form-model";
import type { FieldProps } from "./workspace-provider-fields";

export function AzureSetupFields({ provider, disabled }: FieldProps): ReactElement {
  const { draft } = provider;
  const [touched, setTouched] = useState<Set<AzureRepositoryDraftField>>(() => new Set());
  const parsed = parseAzureRepositoryDraft(draft.azure);
  const collectionUrl = parsed.success ? azureDevOpsHttpConsentCollectionUrl(parsed.data) : null;
  const connectionInput = parsed.success
    ? { repoPath: provider.session?.repoPath ?? "", repository: parsed.data }
    : null;
  return (
    <div className="grid gap-5">
      <ManualRepositoryForm
        disabled={disabled}
        touchedFields={
          provider.error
            ? new Set<AzureRepositoryDraftField>([
                "deployment",
                "serviceUrl",
                "organization",
                "project",
                "name",
              ])
            : touched
        }
        markFieldTouched={(field) => setTouched((current) => new Set(current).add(field))}
        updateField={(field, value) =>
          provider.update((current) => ({
            ...current,
            azure: { ...current.azure, [field]: value },
          }))
        }
        controller={{
          draft: draft.azure,
          updateDraft: (azure) => provider.update((current) => ({ ...current, azure })),
          remoteMappingDrafts: draft.mappings,
          updateRemoteMappings: (mappings) =>
            provider.update((current) => ({ ...current, mappings })),
          mappingErrors: azureRemoteMappingDraftListErrors(
            draft.mappings,
            parsed.success ? parsed.data : undefined,
          ),
          repositoryErrors: azureRepositoryDraftErrors(draft.azure),
          httpCollectionUrl: collectionUrl,
          consentGranted: collectionUrl !== null && draft.consent === collectionUrl,
          setHttpConsent: (granted) =>
            provider.update((current) => ({ ...current, consent: granted ? collectionUrl : null })),
        }}
      />
      {draft.enabled ? (
        <ManagedConnection
          disabled={disabled}
          controller={{
            draft: draft.azure,
            providerEnabled: draft.enabled,
            canManageConnection: connectionInput !== null,
            connectionInput,
            httpConsentSaved: !collectionUrl || draft.consent === collectionUrl,
            connectionState: provider.connection,
            connectionReadFailed: false,
            updatesReady: true,
            isMutatingConnection: provider.pending !== null,
            actionError: provider.error,
            pat: provider.pat,
            setPat: provider.setPat,
            savePat: () => {
              void provider.savePat();
            },
            startSignIn: () => {
              void provider.startSignIn();
            },
            cancelSignIn: () => {
              void provider.cancelSignIn();
            },
            disconnect: () => {
              void provider.disconnect();
            },
            retryConnectionRead: () => {
              void provider.check();
            },
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          The integration will stay disabled. Authentication is optional.
        </p>
      )}
      <div className="grid gap-2 border-t border-border pt-4">
        <Label htmlFor="setup-azure-area">Work item area</Label>
        <Input
          id="setup-azure-area"
          value={draft.areaPath}
          list="setup-azure-areas"
          disabled={disabled || !connectionInput}
          onChange={(event) =>
            provider.update((current) => ({ ...current, areaPath: event.currentTarget.value }))
          }
        />
        <datalist id="setup-azure-areas">
          {provider.areas.map((area) => (
            <option key={area} value={area} />
          ))}
        </datalist>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !draft.enabled || !connectionInput}
          onClick={() => void provider.loadAreas()}
        >
          Load work item areas
        </Button>
        <p className="text-xs text-muted-foreground">
          Work item imports need an area. You can create the workspace without one.
        </p>
      </div>
    </div>
  );
}
