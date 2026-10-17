import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type RemoteAccessState,
  type RemoteAccessEnableInput,
  type RemoteAccessConfiguration,
  type RemoteAccessNetwork,
  type RemoteAccessBridge,
} from "@openducktor/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Radio } from "lucide-react";
import { remoteAccessQueryKey, useRemoteAccess } from "@/state/remote-access-provider";
import { RemoteAccessForm } from "./settings-remote-access-form";
import { RemoteAddress } from "./settings-remote-address";

const labels = { disabled: "Off", starting: "Starting", available: "On", failed: "Failed" };
export function SettingsRemoteAccessSection() {
  const { bridge } = useRemoteAccess();
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Remote control</h3>
        <p className="text-xs text-muted-foreground">Share this host with your other devices.</p>
      </div>
      {bridge ? (
        <RemoteAccessControls bridge={bridge} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Open Settings on the computer that runs the host to change remote control.
        </p>
      )}
    </div>
  );
}

function RemoteAccessControls({ bridge }: { bridge: RemoteAccessBridge }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const { state, message, form } = useRemoteAccessControls(bridge);
  const { status, configuration, failure } = state ?? {};
  const unavailable = failure?.code === "function_unavailable";
  const endpoint = status === "available" ? configuration?.publicEndpoint : undefined;
  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-4">
      <SharingStatus
        id={`${id}-title`}
        status={status}
        pending={form.pending}
        onDisable={() => form.onAction(null)}
      />
      {endpoint ? <RemoteAddress key={endpoint} endpoint={endpoint} /> : null}
      {!unavailable && status ? (
        <Collapsible
          open={status !== "available" || editing}
          onOpenChange={setEditing}
          className="rounded-md border border-border bg-card"
        >
          {status === "available" ? (
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-between rounded-md px-4 py-3 text-sm focus-visible:ring-inset"
              >
                Connection settings
                <ChevronDown className={editing ? "size-4 rotate-180" : "size-4"} />
              </Button>
            </CollapsibleTrigger>
          ) : null}
          <CollapsibleContent
            className={status === "available" ? "border-t border-border p-4" : "p-4"}
          >
            <RemoteAccessForm {...form} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm text-destructive-surface-foreground">
          {message}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Changes apply now and reset when OpenDucktor closes.
      </p>
    </section>
  );
}

function SharingStatus({
  id,
  status,
  pending,
  onDisable,
}: {
  id: string;
  status: RemoteAccessState["status"] | undefined;
  pending: boolean;
  onDisable(): void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-card p-4">
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={id} className="inline-flex items-center gap-2 text-sm font-medium">
            <Radio className="size-4 text-muted-foreground" aria-hidden="true" />
            Host sharing
          </h3>
          <Badge
            variant={
              status === "available" ? "success" : status === "failed" ? "danger" : "secondary"
            }
          >
            {status ? labels[status] : "Loading"}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Anyone who can reach this host can use its workspaces, agents, and terminals. Use a
          trusted network.
        </p>
      </div>
      {status === "available" ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onDisable}>
          Disable remote control
        </Button>
      ) : null}
    </div>
  );
}

function useRemoteAccessControls(bridge: RemoteAccessBridge) {
  const queryClient = useQueryClient();
  const { state, error: stateError } = useRemoteAccess();
  const [draft, setDraft] = useState<RemoteAccessEnableInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const networks = useQuery({
    queryKey: ["shell", "remote-access", "networks"],
    queryFn: () => bridge.readNetworks(),
    staleTime: 0,
  });
  const { status, configuration, failure } = state ?? {};
  const saved = draftFrom(configuration, networks.data ?? []);
  const fields = draft ?? saved;
  const failureMessage = failure ? `${failure.message} ${failure.nextAction}` : undefined;
  const message = error ?? stateError ?? networks.error?.message ?? failureMessage;
  const action = useMutation({
    mutationFn: (configuration: RemoteAccessEnableInput | null) =>
      configuration ? bridge.enable(configuration) : bridge.disable(),
    onMutate: () => queryClient.cancelQueries({ queryKey: remoteAccessQueryKey, exact: true }),
    onSuccess: (next) => {
      queryClient.setQueryData(remoteAccessQueryKey, next);
      if (next.status !== "failed") setDraft(null);
      setError(null);
    },
    onError: (cause) => setError(cause.message),
  });
  const pending = action.isPending || status === "starting" || networks.isPending;
  return {
    state,
    message,
    form: {
      fields,
      networks: networks.data ?? [],
      onChange: (value: Partial<RemoteAccessEnableInput>) => setDraft({ ...fields, ...value }),
      onAction: action.mutate,
      onRefresh: () => {
        void networks.refetch();
      },
      refreshing: networks.isFetching,
      pending,
      status,
      changed:
        fields.listenHost !== saved.listenHost ||
        fields.listenPort !== saved.listenPort ||
        fields.publicEndpoint !== saved.publicEndpoint ||
        JSON.stringify(fields.webOrigins) !== JSON.stringify(saved.webOrigins),
    },
  };
}

function draftFrom(
  configuration: RemoteAccessConfiguration | null | undefined,
  networks: RemoteAccessNetwork[],
): RemoteAccessEnableInput {
  if (!configuration)
    return { listenHost: networks.length === 1 ? networks[0]!.address : "", listenPort: 0 };
  const url = new URL(configuration.publicEndpoint);
  const host = configuration.listenHost;
  const hostname = new URL(
    `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}`,
  ).hostname;
  const direct =
    url.protocol === "http:" &&
    url.pathname === "/" &&
    url.hostname === hostname &&
    (configuration.listenPort === 0 || Number(url.port || 80) === configuration.listenPort);
  const { publicEndpoint, ...fields } = configuration;
  return direct ? fields : { ...fields, publicEndpoint };
}
