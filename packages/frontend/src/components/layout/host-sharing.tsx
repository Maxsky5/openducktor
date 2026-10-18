import { LoaderCircle, Power, Settings } from "lucide-react";
import type { RemoteAccessBridge } from "@openducktor/contracts";
import { RemoteAddress } from "@/components/features/remote-control/remote-address";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRemoteAccessAction } from "@/state/operations/remote-access";
import { useRemoteAccess } from "@/state/remote-access-provider";

const labels = { disabled: "Off", starting: "Starting", available: "On", failed: "Failed" };

export function HostSharing({
  bridge,
  onOpenSettings,
}: {
  bridge: RemoteAccessBridge;
  onOpenSettings: (() => void) | undefined;
}) {
  const { state, pending, message, disable } = useSharingControls(bridge);
  const available = state?.status === "available";
  return (
    <section aria-label="Remote control" className="grid gap-3 border-y border-border py-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Remote control</h3>
        <Badge
          variant={available ? "success" : state?.status === "failed" ? "danger" : "secondary"}
        >
          {state ? labels[state.status] : "Loading"}
        </Badge>
      </div>
      {state?.status === "disabled" ? (
        <p className="text-xs text-muted-foreground">Other devices cannot connect to this host.</p>
      ) : null}
      {available && state.configuration ? (
        <RemoteAddress
          key={state.configuration.publicEndpoint}
          endpoint={state.configuration.publicEndpoint}
          connectedClients={state.connectedClients}
        />
      ) : null}
      <fieldset disabled={pending} className="flex flex-wrap gap-2">
        {onOpenSettings ? (
          <Button type="button" variant="outline" size="sm" onClick={onOpenSettings}>
            <Settings data-icon="inline-start" />
            Remote control settings
          </Button>
        ) : null}
        {available ? (
          <Button type="button" variant="outline" size="sm" onClick={disable}>
            {pending ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Power data-icon="inline-start" />
            )}
            {pending ? "Disabling…" : "Disable remote control"}
          </Button>
        ) : null}
      </fieldset>
      {message ? (
        <p role="alert" className="text-sm text-destructive-surface-foreground">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function useSharingControls(bridge: RemoteAccessBridge) {
  const { state, error } = useRemoteAccess();
  const action = useRemoteAccessAction(bridge);
  const failure = state?.failure;
  return {
    state,
    pending: action.isPending || state?.status === "starting",
    message:
      action.error?.message ?? error ?? (failure && `${failure.message} ${failure.nextAction}`),
    disable: () => action.mutate(null),
  };
}
