import {
  useCallback,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
  type CSSProperties,
} from "react";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import type { ShellBridge } from "@/lib/shell-bridge";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { CONNECTION_TOASTER_ID, HostRetryButton } from "./host-retry-button";
import { DialogEnabledContext } from "@/components/ui/dialog-enabled-context";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

type Connection = NonNullable<ShellBridge["remoteConnection"]>;
const connectionToastStyle: CSSProperties & Record<`--${string}`, string> = {
  "--normal-bg": "var(--card)",
  "--normal-text": "var(--foreground)",
  "--normal-border": "var(--border)",
};

export function RemoteConnectionBoundary({
  connection,
  children,
  changeHost,
  choosingHost = false,
  initialView,
}: PropsWithChildren<{
  connection: Connection | undefined;
  changeHost?: (() => void) | undefined;
  choosingHost?: boolean;
  initialView?: ((state: RemoteConnectionState) => ReactNode) | undefined;
}>) {
  return connection ? (
    <>
      <ConnectedWork
        connection={connection}
        changeHost={changeHost}
        choosingHost={choosingHost}
        initialView={initialView}
      >
        {children}
      </ConnectedWork>
      {/* Retry failures must stay usable while host work is inert. */}
      <Toaster
        id={CONNECTION_TOASTER_ID}
        containerAriaLabel="Host connection notifications"
        className="pointer-events-auto"
        style={connectionToastStyle}
      />
    </>
  ) : (
    children
  );
}

function ConnectedWork({
  connection,
  children,
  changeHost,
  choosingHost,
  initialView,
}: PropsWithChildren<{
  connection: Connection;
  changeHost?: (() => void) | undefined;
  choosingHost: boolean;
  initialView: ((state: RemoteConnectionState) => ReactNode) | undefined;
}>) {
  const [hasConnected, setHasConnected] = useState(
    () => connection.readState().status === "connected",
  );
  const subscribe = useCallback(
    (notify: () => void) =>
      connection.subscribeState((next) => {
        if (next.status === "connected") setHasConnected(true);
        notify();
      }),
    [connection],
  );
  const state = useSyncExternalStore(subscribe, connection.readState, connection.readState);
  const connected = state.status === "connected";
  if (!hasConnected && !connected && initialView) return initialView(state);
  const canRetry = state.status === "failed" || state.status === "disconnected";
  let title = "Connecting to host";
  if (state.status === "failed") title = "Host connection failed";
  else if (state.status === "disconnected") title = "Host connection lost";
  else if (hasConnected) title = "Reconnecting to host";
  const message =
    state.failure?.message ??
    (state.status === "synchronizing"
      ? "Restoring your work from the host."
      : "Waiting for the host to respond.");
  return (
    <>
      {/* App dialogs use portals outside the inert container. */}
      <DialogEnabledContext.Provider value={connected}>
        <div className="contents" inert={!connected}>
          {children}
        </div>
      </DialogEnabledContext.Provider>
      <Dialog open={!connected && !choosingHost}>
        <DialogContent
          className="max-w-md gap-0 overflow-hidden p-0"
          closeButton={null}
          motion="instant"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="px-6 py-6">
            <DialogTitle>
              <span className="flex items-center gap-2">
                {!canRetry ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {title}
              </span>
            </DialogTitle>
            <DialogDescription>{message}</DialogDescription>
          </DialogHeader>
          {state.failure ? (
            <DialogBody className="px-6 pb-5">
              <p className="text-sm text-muted-foreground">{state.failure.nextAction}</p>
            </DialogBody>
          ) : null}
          <DialogFooter className="mt-0 flex-wrap justify-between border-t border-border px-6 py-4">
            {changeHost ? (
              <Button variant="outline" onClick={changeHost}>
                Choose another host
              </Button>
            ) : null}
            <HostRetryButton connection={connection} disabled={!canRetry} className="ml-auto" />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
