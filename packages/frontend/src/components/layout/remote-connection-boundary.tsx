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
  // Automatic attempts alternate between disconnected and connecting. The last failure stays
  // until the connection returns, so the dialog does not change on each attempt.
  const [lastFailure, setLastFailure] = useState<RemoteConnectionState["failure"]>(undefined);
  const subscribe = useCallback(
    (notify: () => void) =>
      connection.subscribeState((next) => {
        if (next.status === "connected") {
          setHasConnected(true);
          setLastFailure(undefined);
        } else if (next.failure) {
          setLastFailure(next.failure);
        }
        notify();
      }),
    [connection],
  );
  const state = useSyncExternalStore(subscribe, connection.readState, connection.readState);
  const connected = state.status === "connected";
  if (!hasConnected && !connected && initialView) return initialView(state, connection);
  const pairing =
    isRemotePairingFailure(state.failure?.code) && endpoint !== undefined && pair !== undefined;
  const { title, message, nextAction, canRetry, waiting } = connectionDialogCopy(
    state,
    hasConnected,
    state.failure ?? lastFailure,
  );
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
  } else if (nextAction) {
    body = (
      <DialogBody className="px-6 pb-5">
        <p className="text-sm text-muted-foreground">{nextAction}</p>
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
                {waiting ? (
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
  /** What the user can do about the failure, or null while the work is restored. */
  nextAction: string | null;
  canRetry: boolean;
  /** An automatic attempt runs. */
  waiting: boolean;
};

/**
 * Automatic attempts alternate between disconnected and connecting. The copy follows the last
 * failure, so the dialog does not change on each attempt.
 */
function connectionDialogCopy(
  state: RemoteConnectionState,
  hasConnected: boolean,
  failure: RemoteConnectionState["failure"],
): ConnectionDialogCopy {
  const stopped = state.status === "idle";
  const failed = state.status === "failed";
  const synchronizing = state.status === "synchronizing";
  let title = "Connecting to host";
  if (stopped) title = "Host connection stopped";
  else if (failed) title = "Host connection failed";
  else if (hasConnected || failure) title = "Host connection lost";
  let message = "Waiting for the host to respond.";
  if (synchronizing) message = "Restoring your work from the host.";
  else if (failure) message = failure.message;
  else if (stopped) message = "Retry the connection or choose another host.";
  // A Retry starts a new attempt at once, also during an automatic attempt.
  return {
    title,
    message,
    nextAction: synchronizing ? null : (failure?.nextAction ?? null),
    canRetry: !synchronizing,
    waiting: !stopped && !failed,
  };
}
