import type { AppUpdateState } from "@openducktor/contracts";
import { RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppUpdateState } from "@/state/app-updates/use-app-update-state";
import { appUpdateErrorPanelClassName, getAppUpdateStatusDisplay } from "./app-update-display";

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
        description: "Reading update status.",
      }
    : getAppUpdateStatusDisplay(controller.state ?? state);
  const visibleState = controller.state ?? state;
  const isBusy =
    isLoadingInitialState ||
    controller.actionInFlight !== null ||
    visibleState.status === "checking";
  const downloadedCheckUnavailable =
    visibleState.status === "downloaded" &&
    (visibleState.installRequested === true || visibleState.installRetryDisabled === true);
  const checkUnavailable =
    visibleState.status === "disabled" ||
    visibleState.status === "downloading" ||
    downloadedCheckUnavailable;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Updates</h3>
            <Badge variant={display.badgeVariant}>{display.label}</Badge>
          </div>
          {display.description && (
            <p className="text-xs text-muted-foreground">{display.description}</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || isBusy || checkUnavailable}
          onClick={() => {
            void controller.checkFromSettings();
          }}
        >
          <RefreshCw className={isBusy ? "animate-spin" : undefined} />
          Check for Updates
        </Button>
      </div>

      {!isLoadingInitialState && (
        <p className="mt-4 flex items-baseline gap-2 text-xs text-muted-foreground">
          Current version
          <span className="font-medium text-foreground">{visibleState.currentVersion}</span>
        </p>
      )}
      {controller.commandError && (
        <p role="alert" className={`mt-3 ${appUpdateErrorPanelClassName}`}>
          {controller.commandError.message}
        </p>
      )}
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
