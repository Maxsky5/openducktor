import { LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useShellPlatform } from "@/lib/shell-platform";
import { useHostConnectionState } from "@openducktor/frontend-core/connection/use-host-connection-state";

export const HOST_RECONNECTING_MESSAGE = "Connection to host lost. Reconnecting...";
export const HOST_RELOAD_REQUIRED_MESSAGE = "The host restarted. Reload the page to reconnect.";

/**
 * The one application message for a lost host connection. Features wait quietly. A remote client
 * shows the reconnect dialog of `RemoteConnectionBoundary` instead.
 */
export function HostConnectionIndicator({ onReload }: { onReload(): void }): ReactElement | null {
  const { remoteConnection } = useShellPlatform();
  const state = useHostConnectionState();
  if (remoteConnection || state === "connected") return null;
  const reloadRequired = state === "reload-required";
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[90] flex justify-center px-4">
      {/* An opaque surface keeps the page, and an embedded browser page, under the message. */}
      <div
        role={reloadRequired ? "alert" : "status"}
        data-page-occluder=""
        className="pointer-events-auto flex items-center gap-3 rounded-full border border-warning-border bg-popover py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-lg"
      >
        {reloadRequired ? (
          <RefreshCw aria-hidden="true" className="size-4 shrink-0 text-warning-accent" />
        ) : (
          <LoaderCircle
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin text-warning-accent"
          />
        )}
        <span>{reloadRequired ? HOST_RELOAD_REQUIRED_MESSAGE : HOST_RECONNECTING_MESSAGE}</span>
        {/* A host on a new address never answers the old page, so Reload stays available. */}
        <Button
          size="xs"
          variant={reloadRequired ? "default" : "secondary"}
          className="h-7 rounded-full px-3"
          onClick={onReload}
        >
          Reload
        </Button>
      </div>
    </div>
  );
}
