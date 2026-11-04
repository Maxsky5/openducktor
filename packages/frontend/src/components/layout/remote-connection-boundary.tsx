import {
  useCallback,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import {
  isRemotePairingFailure,
  type RemoteConnectionState,
} from "@openducktor/host-client/remote";
import { ConnectionPairingForm } from "@/components/features/remote-control/pairing-form";
import { PAIR_WITH_HOST } from "@/components/features/remote-control/connection-flow";
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
type RemoteConnectionBoundaryProps = PropsWithChildren<{
  connection: Connection | undefined;
  endpoint?: string | undefined;
  /** Pairs this client with the host when its saved access is refused. */
  pair?: ((pairingCode: string) => Promise<void>) | undefined;
  changeHost?: (() => void) | undefined;
  choosingHost?: boolean;
  initialView?: ((state: RemoteConnectionState, connection: Connection) => ReactNode) | undefined;
}>;

export function RemoteConnectionBoundary({
  connection,
  endpoint,
  pair,
  children,
  changeHost,
  choosingHost = false,
  initialView,
}: RemoteConnectionBoundaryProps): ReactNode {
  return connection ? (
    <>
      <ConnectedWork
        connection={connection}
        endpoint={endpoint}
        pair={pair}
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
      />
    </>
  ) : (
    children
  );
}

type ConnectedWorkProps = PropsWithChildren<{
  connection: Connection;
  endpoint?: string | undefined;
  pair: ((pairingCode: string) => Promise<void>) | undefined;
  changeHost?: (() => void) | undefined;
  choosingHost: boolean;
  initialView: ((state: RemoteConnectionState, connection: Connection) => ReactNode) | undefined;
}>;

function ConnectedWork({
  connection,
  endpoint,
  pair,
  children,
  changeHost,
  choosingHost,
  initialView,
}: ConnectedWorkProps): ReactNode {
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
  if (!hasConnected && !connected && initialView) return initialView(state, connection);
  const pairing =
    isRemotePairingFailure(state.failure?.code) && endpoint !== undefined && pair !== undefined;
  const { title, message, canRetry } = connectionDialogCopy(state, hasConnected);
  let body: ReactNode = null;
  if (pairing) {
    body = (
      <DialogBody className="px-6 pb-5">
        <ConnectionPairingForm
          connection={connection}
          endpoint={endpoint}
          failure={state.failure}
          pair={pair}
          onCancel={() => changeHost?.()}
        />
      </DialogBody>
    );
  } else if (state.failure) {
    body = (
      <DialogBody className="px-6 pb-5">
        <p className="text-sm text-muted-foreground">{state.failure.nextAction}</p>
      </DialogBody>
    );
  }
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
          className="max-w-md gap-0 overflow-hidden p-0 outline-none"
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
                {pairing ? PAIR_WITH_HOST.title : title}
              </span>
            </DialogTitle>
            <DialogDescription>{pairing ? PAIR_WITH_HOST.description : message}</DialogDescription>
          </DialogHeader>
          {body}
          {!pairing ? (
            <DialogFooter className="mt-0 flex-wrap border-t border-border px-6 py-4">
              {changeHost ? (
                <Button variant="outline" onClick={changeHost}>
                  Choose another host
                </Button>
              ) : null}
              <HostRetryButton connection={connection} disabled={!canRetry} className="ml-auto" />
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

type ConnectionDialogCopy = {
  title: string;
  message: string;
  canRetry: boolean;
};

function connectionDialogCopy(
  state: RemoteConnectionState,
  hasConnected: boolean,
): ConnectionDialogCopy {
  const stopped = state.status === "idle";
  const canRetry = stopped || state.status === "failed" || state.status === "disconnected";
  let title = "Connecting to host";
  if (stopped) title = "Host connection stopped";
  else if (state.status === "failed") title = "Host connection failed";
  else if (state.status === "disconnected") title = "Host connection lost";
  else if (hasConnected) title = "Reconnecting to host";
  let message = "Waiting for the host to respond.";
  if (state.failure) message = state.failure.message;
  else if (stopped) message = "Retry the connection or choose another host.";
  else if (state.status === "synchronizing") message = "Restoring your work from the host.";
  return { title, message, canRetry };
}
