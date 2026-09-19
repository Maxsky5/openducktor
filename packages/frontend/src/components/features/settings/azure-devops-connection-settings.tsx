import { Check, Copy, ExternalLink, KeyRound, LoaderCircle, LogIn, PencilLine } from "lucide-react";
import { type MouseEvent, type ReactElement, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import type { AzureDevOpsGitProviderFormController } from "./use-azure-devops-git-provider-form";

type AzureDevOpsConnectionController = Pick<
  AzureDevOpsGitProviderFormController,
  | "actionError"
  | "canManageConnection"
  | "cancelSignIn"
  | "connectionInput"
  | "connectionState"
  | "consentGranted"
  | "disconnect"
  | "draft"
  | "httpCollectionUrl"
  | "isMutatingConnection"
  | "pat"
  | "providerEnabled"
  | "savePat"
  | "setPat"
  | "startSignIn"
>;

type AzureDevOpsConnectionSettingsProps = {
  controller: AzureDevOpsConnectionController;
  disabled: boolean;
  onBack: () => void;
  onSaveSettings: () => Promise<boolean>;
};

export function AzureDevOpsConnectionSettings({
  controller,
  disabled,
  onBack,
  onSaveSettings,
}: AzureDevOpsConnectionSettingsProps): ReactElement {
  const { connectionInput } = controller;

  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="azure-connection-heading">
      <h3 id="azure-connection-heading" className="sr-only">
        Azure DevOps connection
      </h3>

      {connectionInput ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Repository</p>
            <p className="truncate text-sm font-medium text-foreground">
              {connectionInput.repository.project} / {connectionInput.repository.name}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={connectionInput.repoPath}>
              {connectionInput.repoPath}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onBack}>
            <PencilLine data-icon="inline-start" />
            Change repository
          </Button>
        </div>
      ) : null}

      <ConnectionStatePanel
        controller={controller}
        disabled={disabled}
        onSaveSettings={onSaveSettings}
      />

      {controller.actionError ? (
        <p
          role="alert"
          className="min-w-0 break-words rounded-md border border-destructive-border bg-destructive-surface p-3 text-xs text-destructive-surface-foreground"
        >
          {controller.actionError}
        </p>
      ) : null}
    </section>
  );
}

function ConnectionStatePanel({
  controller,
  disabled,
  onSaveSettings,
}: Pick<
  AzureDevOpsConnectionSettingsProps,
  "controller" | "disabled" | "onSaveSettings"
>): ReactElement {
  if (!controller.canManageConnection) {
    return <UnsavedConnection disabled={disabled} onSaveSettings={onSaveSettings} />;
  }
  if (!controller.providerEnabled) {
    return (
      <section
        className="grid gap-1 border-border border-t pt-4"
        aria-labelledby="azure-account-heading"
      >
        <h4 id="azure-account-heading" className="text-sm font-medium text-foreground">
          Account
        </h4>
        <p className="text-xs text-muted-foreground">
          Enable the Azure DevOps provider above to connect an account.
        </p>
      </section>
    );
  }
  return <ManagedConnection controller={controller} disabled={disabled} />;
}

function UnsavedConnection({
  disabled,
  onSaveSettings,
}: Pick<AzureDevOpsConnectionSettingsProps, "disabled" | "onSaveSettings">): ReactElement {
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const saveAndContinue = async (): Promise<void> => {
    setIsSaving(true);
    setSaveFailed(false);
    try {
      const saved = await onSaveSettings();
      setSaveFailed(!saved);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      className="grid min-w-0 gap-3 border-border border-t pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      aria-labelledby="azure-account-heading"
    >
      <div className="min-w-0 space-y-1">
        <h4 id="azure-account-heading" className="text-sm font-medium text-foreground">
          Account
        </h4>
        <p className="text-xs text-muted-foreground">
          OpenDucktor must save this repository mapping before it can start sign-in.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={disabled || isSaving}
        onClick={() => void saveAndContinue()}
      >
        {isSaving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
        {isSaving ? "Saving…" : "Save and continue"}
      </Button>
      {saveFailed ? (
        <p role="alert" className="text-xs text-danger sm:col-span-2">
          Settings were not saved. Review the form and try again.
        </p>
      ) : null}
    </section>
  );
}

function ManagedConnection({
  controller,
  disabled,
}: Pick<AzureDevOpsConnectionSettingsProps, "controller" | "disabled">): ReactElement {
  const { connectionInput, connectionState, disconnect, isMutatingConnection } = controller;
  const canDisconnect = connectionState.status === "connected" && connectionInput !== null;

  return (
    <section
      className="grid min-w-0 gap-4 border-border border-t pt-4"
      aria-labelledby="azure-account-heading"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h4 id="azure-account-heading" className="text-sm font-medium text-foreground">
            Account
          </h4>
          <p className="min-w-0 break-words text-xs text-muted-foreground">
            {connectionStatusText(connectionState)}
          </p>
        </div>
        {canDisconnect ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || isMutatingConnection}
            onClick={disconnect}
          >
            Disconnect
          </Button>
        ) : null}
      </div>
      <ConnectionActions controller={controller} disabled={disabled} />
    </section>
  );
}

function ConnectionActions({
  controller,
  disabled,
}: Pick<AzureDevOpsConnectionSettingsProps, "controller" | "disabled">): ReactElement {
  if (controller.draft.deployment === "server") {
    return <ServerConnectionActions controller={controller} disabled={disabled} />;
  }
  return (
    <CloudConnectionActions
      connectionState={controller.connectionState}
      disabled={disabled || !controller.connectionInput || controller.isMutatingConnection}
      cancelDisabled={disabled || controller.isMutatingConnection}
      onCancel={controller.cancelSignIn}
      onSignIn={controller.startSignIn}
    />
  );
}

function ServerConnectionActions({
  controller,
  disabled,
}: Pick<AzureDevOpsConnectionSettingsProps, "controller" | "disabled">): ReactElement {
  const {
    connectionInput,
    consentGranted,
    httpCollectionUrl,
    isMutatingConnection,
    pat,
    savePat,
    setPat,
  } = controller;
  const inputDisabled = disabled || isMutatingConnection;
  const saveDisabled =
    inputDisabled ||
    !connectionInput ||
    !pat.trim() ||
    (httpCollectionUrl !== null && !consentGranted);

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-2">
        <Label htmlFor="repo-azure-pat">Personal access token</Label>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative min-w-0">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="repo-azure-pat"
              className="pl-9"
              type="password"
              autoComplete="off"
              value={pat}
              placeholder="Paste a personal access token"
              disabled={inputDisabled}
              onChange={(event) => setPat(event.currentTarget.value)}
            />
          </div>
          <Button type="button" disabled={saveDisabled} onClick={savePat}>
            Save and validate PAT
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The token needs Code read and write, Build read, and repository policy access.
      </p>
    </div>
  );
}

const connectionStatusText = (
  state: AzureDevOpsConnectionController["connectionState"],
): string => {
  if (state.status === "connected") {
    return `Connected${state.account ? ` as ${state.account}` : ""}.`;
  }
  if (state.status === "pending") {
    return "Waiting for you to finish Microsoft sign-in.";
  }
  if (state.status === "error") {
    return state.reason;
  }
  return "Not connected.";
};

type CloudConnectionActionsProps = {
  connectionState: AzureDevOpsConnectionController["connectionState"];
  disabled: boolean;
  cancelDisabled: boolean;
  onCancel: () => void;
  onSignIn: () => void;
};

function CloudConnectionActions({
  connectionState,
  disabled,
  cancelDisabled,
  onCancel,
  onSignIn,
}: CloudConnectionActionsProps): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    successMessage: "Sign-in code copied",
    errorLogContext: "AzureDevOpsConnectionSettings.copyDeviceCode",
  });

  if (connectionState.status === "pending") {
    const { userCode, verificationUri } = connectionState.deviceCode;
    const openSignIn = (event: MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      if (disabled) return;
      void openExternalUrl(verificationUri).catch((cause) => {
        toast.error("Failed to open Microsoft sign-in", {
          description: errorMessage(cause),
        });
      });
    };

    return (
      <div className="grid min-w-0 gap-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Open Microsoft sign-in</p>
            <p className="text-xs text-muted-foreground">
              Use the one-time code below to finish connecting this account.
            </p>
          </div>
          <Button type="button" size="sm" asChild disabled={disabled}>
            <a
              href={verificationUri}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : undefined}
              onClick={openSignIn}
            >
              Open Microsoft sign-in
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        </div>

        <div className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-xs text-muted-foreground">One-time code</p>
            <p className="break-all font-mono text-base font-semibold tracking-wide text-foreground">
              {userCode}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void copyToClipboard(userCode)}
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy code"}
          </Button>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            Cancel sign-in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0">
      <Button type="button" disabled={disabled} onClick={onSignIn}>
        <LogIn data-icon="inline-start" />
        Sign in with Microsoft
      </Button>
    </div>
  );
}
