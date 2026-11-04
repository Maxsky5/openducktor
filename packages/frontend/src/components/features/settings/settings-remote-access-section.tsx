import { useRef, useState, type RefObject } from "react";
import type { RemoteAccessBridge, RemoteAccessState } from "@openducktor/contracts";
import { Button } from "@/components/ui/button";
import { RemoteAccessFailure } from "@/components/features/remote-control/remote-access-failure";
import { RemoteDevices } from "@/components/features/remote-control/remote-devices";
import { connectedDevicesLabel } from "@/components/features/remote-control/remote-control-status";
import { useRemoteAccess } from "@/state/remote-access-provider";
import { useRemoteAccessSetup, type RemoteAccessSetup } from "@/state/operations/remote-access";
import { RemoteAccessForm } from "./settings-remote-access-form";
import { SettingsSwitchRow } from "./settings-switch-row";

export function SettingsRemoteAccessSection() {
  const { bridge } = useRemoteAccess();
  return (
    <div className="@container grid w-full min-w-0 gap-6 p-4">
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-foreground">Remote control</h3>
        <p className="text-xs text-muted-foreground">
          Use this computer from your phone or another computer.
        </p>
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
  const formRef = useRef<HTMLFormElement>(null);
  const setup = useRemoteAccessSetup(bridge);
  const { state, status, pending } = setup;
  const unavailable = state?.failure?.code === "function_unavailable";
  return (
    <section aria-label="Remote control settings" className="grid gap-6">
      <div aria-busy={pending}>
        <SettingsSwitchRow
          title="Enable Remote Control"
          description={switchDescription(state, pending)}
          checked={status === "available"}
          disabled={!status || pending || unavailable}
          ariaLabel="Enable Remote Control"
          onCheckedChange={(checked) => {
            if (checked) formRef.current?.requestSubmit();
            else setup.disable();
          }}
        />
      </div>
      {setup.message ? <RemoteAccessFailure setup={setup} /> : null}
      {state ? <RemoteDevices bridge={bridge} state={state} /> : null}
      {!unavailable && status ? <NetworkSettings setup={setup} formRef={formRef} /> : null}
    </section>
  );
}

function NetworkSettings({
  setup,
  formRef,
}: {
  setup: RemoteAccessSetup;
  formRef: RefObject<HTMLFormElement | null>;
}) {
  const [editing, setEditing] = useState(false);
  const endpoint = setup.status === "available" ? setup.state?.configuration?.publicEndpoint : null;
  return (
    <section aria-label="Network" className="rounded-xl border border-border bg-card shadow-xs">
      {endpoint && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="grid min-w-0 gap-1">
            <p className="text-sm font-medium text-foreground">Network</p>
            <p className="text-xs text-muted-foreground">
              Other devices connect to{" "}
              <span className="break-all font-mono text-foreground">{endpoint}</span>
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="p-4">
          <RemoteAccessForm
            setup={setup}
            ref={formRef}
            onClose={
              endpoint
                ? () => {
                    setup.reset();
                    setEditing(false);
                  }
                : undefined
            }
          />
        </div>
      )}
    </section>
  );
}

function switchDescription(state: RemoteAccessState | undefined, pending: boolean) {
  if (!state) return "Reading remote control status...";
  if (pending) return "Updating remote control...";
  if (state.status === "available") return `On. ${connectedDevicesLabel(state.connectedClients)}.`;
  if (state.status === "failed") return "Off. Remote control could not start.";
  return "Off. Other devices cannot connect.";
}
