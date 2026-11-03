import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { Laptop, Server } from "lucide-react";
import {
  isRemotePairingFailure,
  type RemoteConnectionState,
} from "@openducktor/host-client/remote";
import {
  ConnectionPairingForm,
  PAIR_WITH_HOST,
} from "@/components/features/remote-control/pairing-form";
import { connectedDevicesLabel } from "@/components/features/remote-control/remote-control-status";
import { type RemoteAccessState, remoteFailureText } from "@openducktor/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { localHostLabel, type HostSelection } from "@/lib/host-location";
import type { ShellBridge } from "@/lib/shell-bridge";
import { useRemoteAccess } from "@/state/remote-access-provider";
import { cn } from "@/lib/utils";
import { HostPicker } from "./host-picker";
import { HostRetryButton } from "./host-retry-button";
import { HostConnectionPage } from "./host-connection-page";
import { RemoteConnectionBoundary } from "./remote-connection-boundary";

const HostContext = createContext<{
  selection: HostSelection;
  choose(openSettings?: () => void): void;
} | null>(null);

export function HostConnectionProvider({
  selection,
  connection,
  children,
}: PropsWithChildren<{
  selection: HostSelection;
  connection: ShellBridge["remoteConnection"];
}>) {
  const [dialog, setDialog] = useState<{ openSettings: (() => void) | undefined } | null>(null);
  const open = dialog !== null;
  const trigger = useRef<HTMLElement | null>(null);
  const settings = useRef<(() => void) | null>(null);
  const choose = useCallback((openSettings?: () => void) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog({ openSettings });
  }, []);
  const host = useMemo(() => ({ selection, choose }), [selection, choose]);
  const name =
    selection.target.kind === "remote"
      ? new URL(selection.target.endpoint).host
      : localHostLabel(selection.localHost);
  const remoteEndpoint = selection.target.kind === "remote" ? selection.target.endpoint : undefined;
  // Pairing saves new access for the selected host. The connection then uses it.
  const pair = async (pairingCode: string) => {
    if (remoteEndpoint) await selection.confirm(remoteEndpoint, pairingCode);
  };
  return (
    <HostContext value={host}>
      <RemoteConnectionBoundary
        connection={connection}
        endpoint={remoteEndpoint}
        pair={pair}
        changeHost={() => choose()}
        choosingHost={open}
        initialView={(state, live) => (
          <ConnectionProgress
            state={state}
            name={selection.target.kind === "remote" ? selection.target.endpoint : name}
            connection={live}
            pair={pair}
            choose={() => choose()}
          />
        )}
      >
        {children}
      </RemoteConnectionBoundary>
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent
          className="max-w-lg gap-0 overflow-hidden p-0 outline-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
            // Settings must capture the rail button after this dialog releases focus.
            const openSettings = settings.current;
            settings.current = null;
            openSettings?.();
          }}
        >
          <DialogHeader className="px-6 pb-2 pt-6 pr-12">
            <DialogTitle>Host connection</DialogTitle>
            <DialogDescription>
              {selection.target.kind === "local"
                ? "Share this computer or connect to another host."
                : "Choose the host for this window."}
            </DialogDescription>
          </DialogHeader>
          <HostPicker
            selection={selection}
            onCancel={() => setDialog(null)}
            onOpenSettings={
              dialog?.openSettings
                ? () => {
                    settings.current = dialog.openSettings ?? null;
                    setDialog(null);
                  }
                : undefined
            }
          />
        </DialogContent>
      </Dialog>
    </HostContext>
  );
}

export function HostSwitcher({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const host = useContext(HostContext);
  const { state, error } = useRemoteAccess();
  if (!host) return null;
  const target = host.selection.target;
  const name =
    target.kind === "remote"
      ? new URL(target.endpoint).host
      : localHostLabel(host.selection.localHost);
  const local = target.kind === "local";
  const label = `Host connection: ${name}${local ? sharingDescription(state, error) : ""}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative size-9 text-sidebar-muted-foreground hover:text-sidebar-foreground"
      aria-label={label}
      title={label}
      onClick={() => host.choose(onOpenSettings)}
    >
      {local ? <LocalHostIcon state={state} /> : <Server aria-hidden="true" />}
    </Button>
  );
}

function LocalHostIcon({ state }: { state: RemoteAccessState | undefined }) {
  const sharing = state?.status === "available";
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-flex", sharing && "text-status-running-foreground")}
    >
      <Laptop className="size-5" />
      {sharing && (state.connectedClients ?? 0) > 0 ? (
        <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-status-running" />
      ) : null}
    </span>
  );
}

function sharingDescription(state: RemoteAccessState | undefined, error: string | undefined) {
  if (error || state?.status === "failed")
    return ". Remote control status unavailable. Check Remote control settings.";
  if (state?.status !== "available") return "";
  return `. Remote control is on. ${connectedDevicesLabel(state.connectedClients)}.`;
}

type ConnectionProgressProps = {
  state: RemoteConnectionState;
  name: string;
  connection: NonNullable<ShellBridge["remoteConnection"]>;
  pair(pairingCode: string): Promise<void>;
  choose(): void;
};

function ConnectionProgress({
  state,
  name,
  connection,
  pair,
  choose,
}: ConnectionProgressProps): ReactElement {
  if (isRemotePairingFailure(state.failure?.code))
    return (
      <HostConnectionPage title={PAIR_WITH_HOST.title} description={PAIR_WITH_HOST.description}>
        <ConnectionPairingForm
          connection={connection}
          endpoint={name}
          failure={state.failure}
          pair={pair}
          onCancel={choose}
        />
      </HostConnectionPage>
    );
  const failed = state.status === "failed" || state.status === "disconnected";
  const stopped = state.status === "idle";
  let title = "Connecting to host";
  if (stopped) title = "Host connection stopped";
  else if (failed) title = "Cannot connect to host";
  let message = "Waiting for the host to be ready.";
  if (state.failure) message = remoteFailureText(state.failure);
  else if (stopped) message = "Retry the connection or choose another host.";
  return (
    <HostConnectionPage title={title} description={name}>
      <div className="flex flex-col gap-5">
        <p role={failed ? "alert" : "status"} className="text-sm text-muted-foreground">
          {message}
        </p>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" onClick={choose}>
            Choose another host
          </Button>
          <HostRetryButton
            connection={connection}
            disabled={!failed && !stopped}
            className="ml-auto"
          />
        </div>
      </div>
    </HostConnectionPage>
  );
}
