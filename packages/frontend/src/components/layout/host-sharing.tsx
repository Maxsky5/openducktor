import { LoaderCircle, RadioTower } from "lucide-react";
import type { RemoteAccessBridge } from "@openducktor/contracts";
import { NetworkChoice } from "@/components/features/remote-control/network-choice";
import { RemoteAccessFailure } from "@/components/features/remote-control/remote-access-failure";
import { RemoteDevices } from "@/components/features/remote-control/remote-devices";
import { connectedDevicesLabel } from "@/components/features/remote-control/remote-control-status";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useRemoteAccessSetup, type RemoteAccessSetup } from "@/state/operations/remote-access";

/** Remote control of the local host in Host connection. Settings has the same controls. */
export function HostSharing({ bridge }: { bridge: RemoteAccessBridge }) {
  const setup = useRemoteAccessSetup(bridge);
  const { state } = setup;
  if (!state)
    return (
      <p role="status" className="py-6 text-center text-sm text-muted-foreground">
        Reading remote control status...
      </p>
    );
  if (state.status !== "available" || !state.configuration) return <SharingOff setup={setup} />;
  return (
    <section aria-label="Remote control" className="grid gap-5">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
        <RemoteControlIcon on />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-sm font-medium text-foreground">Remote control is on</p>
          <p role="status" className="text-xs text-muted-foreground">
            {setup.pending
              ? "Turning off remote control..."
              : connectedDevicesLabel(state.connectedClients)}
          </p>
        </div>
        <Switch
          checked
          disabled={setup.pending}
          aria-label="Enable Remote Control"
          onCheckedChange={setup.disable}
        />
      </div>
      {setup.message ? <RemoteAccessFailure setup={setup} /> : null}
      <RemoteDevices bridge={bridge} state={state} />
    </section>
  );
}

/** The network to share on: the list to choose from, or the saved address. */
function SharingNetwork({ setup }: { setup: RemoteAccessSetup }) {
  const { fields } = setup;
  if (setup.networksPending)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Reading networks...
      </p>
    );
  if (fields.publicEndpoint !== undefined)
    return (
      <p className="text-xs text-muted-foreground">
        Other devices connect to{" "}
        <span className="break-all font-mono text-foreground">{fields.publicEndpoint}</span>
      </p>
    );
  return (
    <NetworkChoice
      networks={setup.networks}
      value={fields.listenHost}
      onChange={(listenHost) => setup.change({ listenHost, publicEndpoint: undefined })}
      onRefresh={setup.refreshNetworks}
      refreshing={setup.refreshingNetworks}
      disabled={setup.pending}
    />
  );
}

function SharingOff({ setup }: { setup: RemoteAccessSetup }) {
  const { pending, fields } = setup;
  return (
    <section
      aria-label="Remote control"
      className="grid gap-5 rounded-xl border border-border bg-card p-5 shadow-xs"
    >
      <div className="flex items-start gap-4">
        <RemoteControlIcon on={false} />
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold text-foreground">
            Use this computer from another device
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Turn on remote control, then add your phone or another computer with a one-time code.
          </p>
        </div>
      </div>
      <SharingNetwork setup={setup} />
      {setup.message ? <RemoteAccessFailure setup={setup} /> : null}
      <Button
        type="button"
        className="w-full"
        disabled={pending || setup.networksPending || !setup.ready}
        onClick={() => setup.enable(fields)}
      >
        {pending ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" />
        ) : (
          <RadioTower data-icon="inline-start" />
        )}
        {pending ? "Turning on..." : "Turn on remote control"}
      </Button>
    </section>
  );
}

function RemoteControlIcon({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-muted",
        on ? "text-status-running-foreground" : "text-muted-foreground",
      )}
    >
      <RadioTower className="size-4" />
    </span>
  );
}
