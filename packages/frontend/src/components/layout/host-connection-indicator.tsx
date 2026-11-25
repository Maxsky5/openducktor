import { LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { Alert } from "@/components/ui/alert";
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
      <Alert
        variant="warning"
        role={reloadRequired ? "alert" : "status"}
        className="pointer-events-auto items-center px-4 py-2 shadow-lg [&>svg]:mt-0"
      >
        {reloadRequired ? (
          <RefreshCw aria-hidden="true" />
        ) : (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        )}
        <span>{reloadRequired ? HOST_RELOAD_REQUIRED_MESSAGE : HOST_RECONNECTING_MESSAGE}</span>
        {/* A host on a new address never answers the old page, so Reload stays available. */}
        <Button size="sm" variant={reloadRequired ? "default" : "outline"} onClick={onReload}>
          Reload
        </Button>
      </Alert>
    </div>
  );
}
