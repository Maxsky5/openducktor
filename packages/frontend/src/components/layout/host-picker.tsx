import { ArrowRightLeft, Laptop, LoaderCircle, Server, Settings, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { localHostLabel, type HostSelection } from "@/lib/host-location";
import { cn } from "@/lib/utils";
import { useRemoteAccess } from "@/state/remote-access-provider";
import { HostSharing } from "./host-sharing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectedView } from "@/components/features/remote-control/connection-feedback";
import { HostConnectFields, useHostConnectForm, type HostAction } from "./host-connect-form";

export function HostPicker({
  selection,
  error: initialError,
  onCancel,
  onOpenSettings,
}: {
  selection: HostSelection;
  error?: string | undefined;
  onCancel?: () => void;
  onOpenSettings?: (() => void) | undefined;
}) {
  const { target } = selection;
  const { bridge } = useRemoteAccess();
  const connect = useHostConnectForm(selection, initialError);
  const { pending } = connect;
  const currentHost = target.kind !== "picker";
  const Body = onCancel ? ScrollArea : "div";

  const connectForm = (
    <form
      noValidate
      aria-busy={pending !== null}
      onSubmit={connect.submit}
      className="flex min-h-0 flex-1 flex-col"
    >
      <Body className={onCancel ? "flex min-h-0 flex-1 flex-col" : undefined}>
        <div className={cn("flex flex-col gap-5", onCancel && "px-6 py-5")}>
          {connect.connected ? (
            <ConnectedView endpoint={connect.connected} />
          ) : (
            <>
              {currentHost ? <SelectedHost selection={selection} /> : null}
              <HostConnectFields
                currentHost={currentHost}
                address={connect.endpoint}
                code={connect.code}
                busy={pending !== null}
                onAddressChange={connect.changeAddress}
                onCodeChange={connect.changeCode}
                failure={connect.failure}
              />
            </>
          )}
        </div>
      </Body>
      {connect.connected ? null : (
        <ConnectionActions
          selection={selection}
          pending={pending}
          run={connect.run}
          onCancel={onCancel}
          canSubmit={Boolean(connect.endpoint.trim())}
        />
      )}
    </form>
  );
  if (!onCancel || target.kind !== "local" || !bridge) return connectForm;
  return (
    <Tabs defaultValue="share" className="min-h-0 gap-0">
      <TabsList aria-label="Host connection mode" className="mx-6 mt-2 grid h-9 w-auto grid-cols-2">
        <TabsTrigger value="share" disabled={pending !== null}>
          Remote control
        </TabsTrigger>
        <TabsTrigger value="connect" disabled={pending !== null}>
          Connect to a host
        </TabsTrigger>
      </TabsList>
      <TabsContent value="share" className="mt-0 flex min-h-0 flex-col">
        <ScrollArea className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 py-5">
            <HostSharing bridge={bridge} />
          </div>
        </ScrollArea>
        <DialogFooter className="mt-0 flex-row items-center gap-3 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {onOpenSettings ? (
            <Button type="button" variant="outline" onClick={onOpenSettings}>
              <Settings data-icon="inline-start" />
              Network settings
            </Button>
          ) : null}
        </DialogFooter>
      </TabsContent>
      <TabsContent value="connect" className="mt-0 flex min-h-0 flex-col">
        {connectForm}
      </TabsContent>
    </Tabs>
  );
}

function ConnectButton({
  currentHost,
  connecting,
  disabled,
}: {
  currentHost: boolean;
  connecting: boolean;
  disabled: boolean;
}) {
  const Icon = currentHost ? ArrowRightLeft : Server;
  return (
    <Button type="submit" disabled={disabled}>
      {connecting ? (
        <LoaderCircle data-icon="inline-start" className="animate-spin" />
      ) : (
        <Icon data-icon="inline-start" />
      )}
      {connecting ? "Connecting…" : currentHost ? "Switch host" : "Connect to host"}
    </Button>
  );
}

function ConnectionActions({
  selection,
  pending,
  run,
  onCancel,
  canSubmit,
}: {
  selection: HostSelection;
  pending: HostAction | null;
  run(action: HostAction, work: () => Promise<void>): Promise<void>;
  onCancel: (() => void) | undefined;
  canSubmit: boolean;
}) {
  const Footer = onCancel ? DialogFooter : "div";
  return (
    <Footer
      role="group"
      aria-label="Connection actions"
      className={
        onCancel ? "mt-0 flex-wrap items-end gap-3 border-t border-border px-6 py-4" : "mt-5"
      }
    >
      {onCancel ? (
        <Button
          type="button"
          variant="outline"
          className="self-start sm:self-auto"
          onClick={onCancel}
        >
          Cancel
        </Button>
      ) : null}
      <div className={cn("flex gap-2", onCancel ? "ml-auto flex-wrap justify-end" : "flex-col")}>
        <HostActions selection={selection} pending={pending} run={run} />
        <ConnectButton
          currentHost={selection.target.kind !== "picker"}
          connecting={pending === "connect"}
          disabled={!canSubmit}
        />
      </div>
    </Footer>
  );
}

function SelectedHost({ selection }: { selection: HostSelection }) {
  const { target } = selection;
  const Icon = target.kind === "remote" ? Server : Laptop;
  return (
    <dl className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-xs text-muted-foreground">Current host</dt>
        <dd className="break-all text-sm font-medium">
          {target.kind === "remote" ? target.endpoint : localHostLabel(selection.localHost)}
        </dd>
      </div>
    </dl>
  );
}

function HostActions({
  selection,
  pending,
  run,
}: {
  selection: HostSelection;
  pending: HostAction | null;
  run(action: HostAction, work: () => Promise<void>): Promise<void>;
}) {
  return (
    <>
      {selection.localHost && selection.target.kind !== "local" ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void run("local", () => selection.select(null))}
        >
          {pending === "local" ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Laptop data-icon="inline-start" />
          )}
          {pending === "local"
            ? "Switching…"
            : selection.localHost === "electron"
              ? "Use desktop host"
              : "Use web runner"}
        </Button>
      ) : null}
      {selection.target.kind === "remote" ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void run("disconnect", selection.disconnect)}
        >
          {pending === "disconnect" ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Unplug data-icon="inline-start" />
          )}
          {pending === "disconnect" ? "Disconnecting…" : "Disconnect"}
        </Button>
      ) : null}
    </>
  );
}
