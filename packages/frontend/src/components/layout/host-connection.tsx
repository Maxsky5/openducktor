import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Laptop, Server } from "lucide-react";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import type { RemoteAccessState } from "@openducktor/contracts";
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

const HostContext = createContext<{ selection: HostSelection; choose(): void } | null>(null);

export function HostConnectionProvider({
  selection,
  connection,
  children,
}: PropsWithChildren<{
  selection: HostSelection;
  connection: ShellBridge["remoteConnection"];
}>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const choose = useCallback(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const host = useMemo(() => ({ selection, choose }), [selection, choose]);
  const name =
    selection.target.kind === "remote"
      ? new URL(selection.target.endpoint).host
      : localHostLabel(selection.localHost);
  return (
    <HostContext value={host}>
      <RemoteConnectionBoundary
        connection={connection}
        changeHost={choose}
        choosingHost={open}
        initialView={(state) => (
          <ConnectionProgress state={state} name={name} connection={connection} choose={choose} />
        )}
      >
        {children}
      </RemoteConnectionBoundary>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-xl gap-0 overflow-hidden p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader className="px-6 pb-1 pt-6">
            <DialogTitle>Host connection</DialogTitle>
            <DialogDescription>Choose the host for this window.</DialogDescription>
          </DialogHeader>
          <HostPicker selection={selection} onCancel={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </HostContext>
  );
}

export function HostSwitcher() {
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
      onClick={host.choose}
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
      className={cn("relative inline-flex", sharing && "text-primary dark:text-violet-300")}
    >
      <Laptop className="size-5" />
      {sharing && state.connectedClients > 0 ? (
        <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-current" />
      ) : null}
    </span>
  );
}

function sharingDescription(state: RemoteAccessState | undefined, error: string | undefined) {
  if (error || state?.status === "failed")
    return ". Remote control status unavailable. Check Remote control settings.";
  if (state?.status !== "available") return "";
  const clients = state.connectedClients;
  const description =
    clients === 0
      ? "No clients connected."
      : `${clients} ${clients === 1 ? "client" : "clients"} connected.`;
  return `. Remote control is on. ${description}`;
}

function ConnectionProgress({
  state,
  name,
  connection,
  choose,
}: {
  state: RemoteConnectionState;
  name: string;
  connection: ShellBridge["remoteConnection"];
  choose(): void;
}) {
  const failed = state.status === "failed" || state.status === "disconnected";
  return (
    <HostConnectionPage
      title={failed ? "Cannot connect to host" : "Connecting to host"}
      description={name}
    >
      <div className="flex flex-col gap-5">
        <p role={failed ? "alert" : "status"} className="text-sm text-muted-foreground">
          {state.failure
            ? `${state.failure.message} ${state.failure.nextAction}`
            : "Waiting for the host to be ready."}
        </p>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" onClick={choose}>
            Choose another host
          </Button>
          {connection ? (
            <HostRetryButton connection={connection} disabled={!failed} className="ml-auto" />
          ) : null}
        </div>
      </div>
    </HostConnectionPage>
  );
}
