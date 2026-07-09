import { Download, RefreshCw, RotateCw, X } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAppUpdateState } from "@/state/app-updates/use-app-update-state";
import {
  canDownloadUpdate,
  canInstallUpdate,
  getAppUpdateAvailableVersion,
  getAppUpdateError,
  getAppUpdateProgressPercent,
  getAppUpdatePromptKey,
  getAppUpdateStatusDisplay,
  isActionableUpdateError,
  isManualUpdateCheckState,
} from "./app-update-display";

const promptStatuses = new Set(["available", "downloading", "downloaded"]);

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

  const shouldShowPrompt =
    promptStatuses.has(state.status) ||
    isActionableUpdateError(state) ||
    (isManualUpdateCheckState(state) &&
      (state.status === "checking" ||
        state.status === "upToDate" ||
        state.status === "disabled" ||
        state.status === "error"));

  if (!shouldShowPrompt) {
    return null;
  }

  const display = getAppUpdateStatusDisplay(state);
  const isBusy = controller.actionInFlight !== null || state.status === "checking";
  const showProgress = state.status === "downloading";
  const progressPercent = Math.round(getAppUpdateProgressPercent(state) ?? 0);
  const availableVersion = getAppUpdateAvailableVersion(state);
  const error = getAppUpdateError(state);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] w-[min(420px,calc(100vw-2rem))]">
      <Card className="pointer-events-auto rounded-lg border-border bg-card p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={display.badgeVariant}>{display.label}</Badge>
              {state.status === "checking" && <RefreshCw className="size-4 animate-spin" />}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{display.description}</p>
              <p className="text-xs text-muted-foreground">
                Current {state.currentVersion}
                {availableVersion ? ` · New ${availableVersion}` : ""}
              </p>
            </div>
            {showProgress && (
              <div className="space-y-1.5">
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                >
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{progressPercent}% downloaded</p>
              </div>
            )}
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive-surface/60 px-3 py-2 text-xs text-destructive-surface-foreground">
                {error.message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {canDownloadUpdate(state) && (
                <Button
                  type="button"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => {
                    void controller.download();
                  }}
                >
                  <Download />
                  Download Update
                </Button>
              )}
              {canInstallUpdate(state) && (
                <Button
                  type="button"
                  size="sm"
                  disabled={isBusy}
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Dismiss update prompt"
            onClick={() => {
              setDismissedKey(promptKey);
            }}
          >
            <X />
          </Button>
        </div>
      </Card>
    </div>
  );
}
