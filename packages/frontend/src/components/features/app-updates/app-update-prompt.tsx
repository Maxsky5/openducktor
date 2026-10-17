import type { AppUpdateState } from "@openducktor/contracts";
import { CircleAlert, Download, ExternalLink, RefreshCw, RotateCw, X } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { errorMessage as readErrorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";
import {
  type AppUpdateStateController,
  useAppUpdateState,
} from "@/state/app-updates/use-app-update-state";
import {
  canDownloadUpdate,
  canInstallUpdate,
  getAppUpdateAvailableVersion,
  getAppUpdateError,
  getAppUpdateProgressPercent,
  getAppUpdatePromptKey,
  getAppUpdateStatusDisplay,
  isActionableUpdateError,
  isMenuUpdateCheckState,
  requiresManualAppUpdate,
} from "./app-update-display";
import { AppUpdateProgress } from "./app-update-progress";

const promptStatuses = new Set(["available", "downloading", "downloaded"]);
const userCheckStatuses = new Set(["checking", "upToDate", "disabled", "error"]);
const RELEASES_URL = "https://github.com/Maxsky5/openducktor/releases";

const openReleaseUrl = (url: string, failureMessage: string): void => {
  void openExternalUrl(url).catch((cause) => {
    toast.error(failureMessage, {
      description: readErrorMessage(cause),
    });
  });
};

const releaseNotesUrl = (version: string): string =>
  `${RELEASES_URL}/tag/v${encodeURIComponent(version)}`;

const openReleaseVersion = (version: string): void => {
  openReleaseUrl(releaseNotesUrl(version), "Failed to open the release");
};

function ReleaseNotesLink({ version }: { version: string }): ReactElement {
  const url = releaseNotesUrl(version);
  const openLink = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    openReleaseUrl(url, "Failed to open release notes");
  };
  const openLinkFromAuxiliaryClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button === 1) {
      openLink(event);
    }
  };

  return (
    <a
      href={url}
      onClick={openLink}
      onAuxClick={openLinkFromAuxiliaryClick}
      className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-foreground underline decoration-muted-foreground underline-offset-2 transition hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Release note
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}

function AppUpdateStatusIcon({
  hasError,
  manualUpdateRequired,
}: {
  hasError: boolean;
  manualUpdateRequired: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg",
        !hasError && "border border-border bg-muted text-foreground",
        hasError &&
          !manualUpdateRequired &&
          "bg-destructive-surface text-destructive-surface-foreground",
        manualUpdateRequired && "bg-warning-surface text-warning-surface-foreground",
      )}
    >
      {hasError ? <CircleAlert /> : <Download />}
    </div>
  );
}

function AppUpdateErrorPanel({
  message,
  manualUpdateRequired,
}: {
  message: string;
  manualUpdateRequired: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm leading-5",
        manualUpdateRequired &&
          "border-warning-border bg-warning-surface text-warning-surface-foreground",
        !manualUpdateRequired &&
          "border-destructive/30 bg-destructive-surface text-destructive-surface-foreground",
      )}
    >
      <CircleAlert className="mt-0.5 shrink-0" />
      <p className="max-h-32 min-w-0 overflow-y-auto break-words whitespace-pre-wrap">{message}</p>
    </div>
  );
}

function AppUpdateActions({
  state,
  isBusy,
  manualUpdateRequired,
  onDownload,
  onInstall,
}: {
  state: AppUpdateState;
  isBusy: boolean;
  manualUpdateRequired: boolean;
  onDownload: () => void;
  onInstall: () => void;
}): ReactElement {
  // A blocked install retry offers the release page instead.
  const recoveryVersion =
    state.status === "downloaded" && state.installRetryDisabled === true
      ? state.availableVersion
      : undefined;
  return (
    <div className="grid gap-2">
      {canDownloadUpdate(state) && (
        <Button
          type="button"
          size="sm"
          variant="accent"
          className="w-full"
          disabled={isBusy}
          onClick={onDownload}
        >
          <Download />
          Download Update
        </Button>
      )}
      {canInstallUpdate(state) && (
        <Button
          type="button"
          size="sm"
          variant="accent"
          className="w-full"
          disabled={isBusy}
          onClick={onInstall}
        >
          <RotateCw />
          Restart to Install
        </Button>
      )}
      {recoveryVersion && (
        <Button
          type="button"
          size="sm"
          variant="accent"
          className="w-full"
          onClick={() => {
            openReleaseVersion(recoveryVersion);
          }}
        >
          <ExternalLink data-icon="inline-start" />
          {manualUpdateRequired ? "Download Signed Release" : "Download Latest Release"}
        </Button>
      )}
    </div>
  );
}

const joinLiveRegionParts = (parts: Array<string | undefined>): string =>
  parts
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim().replace(/\.+$/, ""))
    .join(". ");

/** The prompt shows an update to act on, an actionable error, or the result of a check the user started. */
const shouldShowAppUpdatePrompt = (
  state: AppUpdateState,
  hasReceivedStateEvent: boolean,
): boolean => {
  if (promptStatuses.has(state.status) || isActionableUpdateError(state)) {
    return true;
  }
  const isUserCheck =
    isMenuUpdateCheckState(state) ||
    (hasReceivedStateEvent && "checkInitiator" in state && state.checkInitiator === "settings");
  return isUserCheck && userCheckStatuses.has(state.status);
};

/** Derives what the prompt shows from the update state and the last command result. */
const getAppUpdatePromptView = (
  state: AppUpdateState,
  controller: Pick<AppUpdateStateController, "actionInFlight" | "commandError">,
) => {
  const display = getAppUpdateStatusDisplay(state);
  const installRequested = state.status === "downloaded" && state.installRequested === true;
  const isBusy =
    controller.actionInFlight !== null || state.status === "checking" || installRequested;
  const showProgress = state.status === "downloading";
  const progressPercent = Math.round(getAppUpdateProgressPercent(state) ?? 0);
  const availableVersion = getAppUpdateAvailableVersion(state);
  const error = getAppUpdateError(state);
  const manualUpdateRequired = requiresManualAppUpdate(state);
  const errorMessage = manualUpdateRequired
    ? error?.message
    : (controller.commandError?.message ?? error?.message);
  const releaseNotesVersion = promptStatuses.has(state.status) ? availableVersion : undefined;
  const showDescription = state.status !== "available" && display.description !== undefined;
  const visibleVersionText = `Current ${state.currentVersion}${
    availableVersion ? ` · New ${availableVersion}` : ""
  }`;
  const liveRegionText = joinLiveRegionParts([
    display.label,
    showDescription ? display.description : undefined,
    visibleVersionText,
    errorMessage,
  ]);
  return {
    display,
    isBusy,
    showProgress,
    progressPercent,
    availableVersion,
    manualUpdateRequired,
    errorMessage,
    releaseNotesVersion,
    showDescription,
    liveRegionText,
  };
};

export function AppUpdatePrompt(): ReactElement | null {
  const controller = useAppUpdateState();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const state = controller.state;
  if (!state) {
    return null;
  }

  const promptKey = getAppUpdatePromptKey(state);
  if (dismissedKey === promptKey) {
    return null;
  }

  if (!shouldShowAppUpdatePrompt(state, controller.hasReceivedStateEvent)) {
    return null;
  }

  const {
    display,
    isBusy,
    showProgress,
    progressPercent,
    availableVersion,
    manualUpdateRequired,
    errorMessage,
    releaseNotesVersion,
    showDescription,
    liveRegionText,
  } = getAppUpdatePromptView(state, controller);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] w-[min(360px,calc(100vw-2rem))]">
      <Card className="light pointer-events-auto overflow-hidden border-border bg-popover shadow-lg backdrop-blur-none supports-[backdrop-filter]:bg-popover">
        <p role="status" aria-live="polite" className="sr-only">
          {liveRegionText}
        </p>
        <CardHeader className="flex-row items-center gap-3 px-4 pt-4">
          <AppUpdateStatusIcon
            hasError={Boolean(errorMessage)}
            manualUpdateRequired={manualUpdateRequired}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{display.label}</p>
              {state.status === "checking" && <RefreshCw className="animate-spin" />}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {availableVersion
                ? `${state.currentVersion} → ${availableVersion}`
                : state.currentVersion}
            </p>
            {showDescription && (
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{display.description}</p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-1 size-8 shrink-0"
            aria-label="Dismiss update prompt"
            onClick={() => {
              setDismissedKey(promptKey);
            }}
          >
            <X />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4 pt-3 pb-4">
          {releaseNotesVersion && <ReleaseNotesLink version={releaseNotesVersion} />}
          {showProgress && <AppUpdateProgress percent={progressPercent} />}
          {errorMessage && (
            <AppUpdateErrorPanel
              message={errorMessage}
              manualUpdateRequired={manualUpdateRequired}
            />
          )}
          <AppUpdateActions
            state={state}
            isBusy={isBusy}
            manualUpdateRequired={manualUpdateRequired}
            onDownload={() => {
              void controller.download();
            }}
            onInstall={() => {
              void controller.install();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
