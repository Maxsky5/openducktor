import type { ReactElement } from "react";
import { Globe, LoaderCircle, Monitor, Smartphone, Trash2, type LucideIcon } from "lucide-react";
import type {
  RemoteAccessBridge,
  RemoteApprovedClient,
  RemoteClientKind,
} from "@openducktor/contracts";
import { Button } from "@/components/ui/button";
import { useRevokeRemoteClient } from "@/state/operations/remote-access";

const CLIENT_KINDS = {
  mobile: { name: "Mobile app", icon: Smartphone },
  desktop: { name: "Desktop app", icon: Monitor },
  browser: { name: "Web browser", icon: Globe },
} satisfies Record<RemoteClientKind, { name: string; icon: LucideIcon }>;

type PairedDevicesProps = {
  bridge: RemoteAccessBridge;
  /** `null` when the host cannot report its devices. */
  clients: RemoteApprovedClient[] | null;
};

/** The saved approvals of the local host, connected ones first. */
export function PairedDevices({ bridge, clients }: PairedDevicesProps): ReactElement {
  const revoke = useRevokeRemoteClient(bridge);
  const connected = clients?.filter((client) => client.status === "connected").length ?? 0;
  let content: ReactElement;
  if (clients === null) {
    content = (
      <p role="status" className="text-xs text-muted-foreground">
        Device status is unavailable.
      </p>
    );
  } else if (clients.length === 0) {
    content = (
      <p className="rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground">
        No paired devices. Devices appear here after they connect with a code.
      </p>
    );
  } else {
    const sorted = [...clients].sort(
      (a, b) => Number(b.status === "connected") - Number(a.status === "connected"),
    );
    content = (
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {sorted.map((client) => (
          <DeviceRow
            key={client.clientId}
            client={client}
            removing={revoke.isPending && revoke.variables === client.clientId}
            disabled={revoke.isPending}
            error={
              revoke.isError && revoke.variables === client.clientId
                ? revoke.error.message
                : undefined
            }
            onRemove={() => revoke.mutate(client.clientId)}
          />
        ))}
      </ul>
    );
  }
  return (
    <section aria-label="Paired devices" className="grid min-w-0 content-start gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-medium text-foreground">Paired devices</h4>
        {clients?.length ? (
          <p className="text-xs text-muted-foreground">{connected} connected</p>
        ) : null}
      </div>
      {content}
      {clients?.length ? (
        <p className="text-xs text-muted-foreground">
          Names show the app type. They do not prove which device it is.
        </p>
      ) : null}
    </section>
  );
}

function DeviceRow({
  client,
  removing,
  disabled,
  error,
  onRemove,
}: {
  client: RemoteApprovedClient;
  removing: boolean;
  disabled: boolean;
  error: string | undefined;
  onRemove(): void;
}) {
  const { name, icon: Icon } = CLIENT_KINDS[client.kind];
  const online = client.status === "connected";
  return (
    <li className="grid gap-2 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
          {online ? (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-status-running ring-2 ring-card"
            />
          ) : null}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-sm text-foreground">
            {name}{" "}
            <span className="font-mono text-xs text-muted-foreground">{client.reference}</span>
          </p>
          <p className="text-xs text-muted-foreground">{online ? "Connected" : "Offline"}</p>
        </div>
        <Button
          type="button"
          variant="destructiveGhost"
          size="sm"
          aria-label={`Remove ${name} ${client.reference}`}
          title="Remove access. The device needs a new code to connect again."
          disabled={disabled}
          onClick={onRemove}
        >
          {removing ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Trash2 data-icon="inline-start" />
          )}
          {removing ? "Removing..." : "Remove"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="pl-11 text-xs text-destructive-surface-foreground">
          {error}
        </p>
      ) : null}
    </li>
  );
}
