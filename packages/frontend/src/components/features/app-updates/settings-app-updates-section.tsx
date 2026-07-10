import type { AppUpdateState } from "@openducktor/contracts";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppUpdateState } from "@/state/app-updates/use-app-update-state";
import {
  appUpdateErrorPanelClassName,
  canDownloadUpdate,
  canInstallUpdate,
  getAppUpdateAvailableVersion,
  getAppUpdateError,
  getAppUpdateProgressPercent,
  getAppUpdateStatusDisplay,
} from "./app-update-display";

type AppUpdateProgressProps = {
  percent: number;
};

function AppUpdateProgress({ percent }: AppUpdateProgressProps): ReactElement {
  return (
    <div className="space-y-1.5">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Update download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={`${Math.round(percent)}% downloaded`}
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{Math.round(percent)}% downloaded</p>
    </div>
  );
}

type VersionRowsProps = {
  state: AppUpdateState;
};

function VersionRows({ state }: VersionRowsProps): ReactElement {
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
        <p className="text-muted-foreground">Current version</p>
        <p className="font-medium text-foreground">{state.currentVersion}</p>
      </div>
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
        <p className="text-muted-foreground">Available version</p>
        <p className="font-medium text-foreground">
          {getAppUpdateAvailableVersion(state) ?? "None"}
        </p>
      </div>
    </div>
  );
}

type SettingsAppUpdatesContentProps = {
  disabled: boolean;
  state: AppUpdateState;
};

function SettingsAppUpdatesContent({
  disabled,
  state,
}: SettingsAppUpdatesContentProps): ReactElement {
  const controller = useAppUpdateState();
  const isLoadingInitialState = controller.isLoadingInitialState && controller.state === null;
  const display = isLoadingInitialState
    ? {
        badgeVariant: "secondary" as const,
        label: "Loading update status",
        description: "Reading desktop update status from the shell.",
      }
    : getAppUpdateStatusDisplay(controller.state ?? state);
  const visibleState = controller.state ?? state;
  const installRequested =
    visibleState.status === "downloaded" && visibleState.installRequested === true;
  const isBusy =
    isLoadingInitialState ||
    controller.actionInFlight !== null ||
    visibleState.status === "checking" ||
    installRequested;
  const downloadAllowed = canDownloadUpdate(visibleState);
  const installAllowed = canInstallUpdate(visibleState);
  const error = getAppUpdateError(visibleState);
  const errorMessage = controller.commandError?.message ?? error?.message;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Desktop Updates</h3>
            <Badge variant={display.badgeVariant}>{display.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{display.description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || isBusy}
          onClick={() => {
            void controller.checkFromSettings();
          }}
        >
          <RefreshCw className={isBusy ? "animate-spin" : undefined} />
          Check for Updates
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {!isLoadingInitialState && <VersionRows state={visibleState} />}
        {visibleState.status === "downloading" && (
          <AppUpdateProgress percent={getAppUpdateProgressPercent(visibleState) ?? 0} />
        )}
        {errorMessage && <p className={appUpdateErrorPanelClassName}>{errorMessage}</p>}
        <div className="flex flex-wrap gap-2">
          {downloadAllowed && (
            <Button
              type="button"
              size="sm"
              disabled={disabled || controller.actionInFlight !== null}
              onClick={() => {
                void controller.download();
              }}
            >
              <Download />
              Download Update
            </Button>
          )}
          {installAllowed && (
            <Button
              type="button"
              size="sm"
              disabled={disabled || controller.actionInFlight !== null}
              onClick={() => {
                void controller.install();
              }}
            >
              <RotateCw />
              Restart to Install
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type SettingsAppUpdatesSectionProps = {
  disabled: boolean;
};

const initialState: AppUpdateState = {
  status: "idle",
  currentVersion: "unknown",
};

export function SettingsAppUpdatesSection({
  disabled,
}: SettingsAppUpdatesSectionProps): ReactElement {
  return <SettingsAppUpdatesContent disabled={disabled} state={initialState} />;
}
