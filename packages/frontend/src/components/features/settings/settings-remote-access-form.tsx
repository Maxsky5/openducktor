import { useId, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import {
  remoteAccessEnableInputSchema,
  type RemoteAccessEnableInput,
  type RemoteAccessNetwork,
  type RemoteAccessState,
} from "@openducktor/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function RemoteAccessForm({
  fields,
  networks,
  onChange,
  onAction,
  onRefresh,
  pending,
  refreshing,
  status,
  changed,
}: {
  fields: RemoteAccessEnableInput;
  networks: RemoteAccessNetwork[];
  onChange(value: Partial<RemoteAccessEnableInput>): void;
  onAction(configuration: RemoteAccessEnableInput | null): void;
  onRefresh(): void;
  pending: boolean;
  refreshing: boolean;
  status: RemoteAccessState["status"] | undefined;
  changed: boolean;
}) {
  const id = useId();
  const [submitted, setSubmitted] = useState(false);
  const [advanced, setAdvanced] = useState(
    fields.listenPort !== 0 || fields.publicEndpoint !== undefined,
  );
  const parsed = remoteAccessEnableInputSchema.safeParse(fields);
  const issue = submitted && !parsed.success ? parsed.error.issues[0] : undefined;
  const invalid = issue?.path[0];
  const error = fieldError(invalid, fields.listenPort);
  const selected = networks.some((network) => network.address === fields.listenHost);
  const label = status === "available" ? "Apply connection changes" : "Enable remote control";
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (parsed.success) {
          onAction(parsed.data);
          return;
        }
        const name = String(parsed.error.issues[0]?.path[0]);
        const field = event.currentTarget.elements.namedItem(name);
        if (field instanceof HTMLInputElement) field.focus();
        else event.currentTarget.querySelector<HTMLButtonElement>('[role="radio"]')?.focus();
      }}
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Label id={`${id}-networks`}>Choose a network</Label>
          <Button type="button" size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw
              data-icon="inline-start"
              className={refreshing ? "animate-spin" : undefined}
            />
            {refreshing ? "Refreshing…" : "Refresh networks"}
          </Button>
        </div>
        <p id={`${id}-network-help`} className="text-xs text-muted-foreground">
          Select a network shared with your other device. The host chooses a free port.
        </p>
        <RadioGroup
          value={selected ? fields.listenHost : ""}
          onValueChange={(listenHost) =>
            onChange({ listenHost, listenPort: 0, publicEndpoint: undefined })
          }
          aria-labelledby={`${id}-networks`}
          aria-describedby={`${id}-network-help`}
          aria-invalid={invalid === "listenHost"}
          disabled={pending}
          className="grid gap-2 sm:grid-cols-2"
        >
          {networks.map((network) => (
            <Label
              key={network.address}
              htmlFor={`${id}-${network.address}`}
              className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-input px-3 py-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"
            >
              <RadioGroupItem id={`${id}-${network.address}`} value={network.address} />
              <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="break-all text-sm text-foreground">{network.address}</span>
                <span className="text-xs font-normal text-foreground/80">{network.name}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        {networks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No network addresses found. Connect this computer to a network, then refresh.
          </p>
        ) : null}
        {fields.listenHost && !selected ? (
          <p className="text-xs text-muted-foreground">
            Custom listen address: <code>{fields.listenHost}</code>. Change it in Advanced or choose
            a network above.
          </p>
        ) : null}
        <Collapsible
          open={advanced}
          onOpenChange={setAdvanced}
          className="border-t border-border pt-3"
        >
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              <ChevronDown data-icon="inline-start" /> Advanced
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <AdvancedSettings id={id} fields={fields} onChange={onChange} invalid={invalid} />
          </CollapsibleContent>
        </Collapsible>
        {error ? (
          <p role="alert" className="text-sm text-destructive-surface-foreground">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={status === "available" && !changed}>
            {pending ? "Updating remote control..." : label}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function fieldError(field: PropertyKey | undefined, port: number): string | undefined {
  if (field === "listenHost")
    return "Choose a network. For a custom listen address, set a reachable proxy address in Advanced.";
  if (field === "listenPort")
    return port === 0
      ? "Use a fixed port for a proxy. Turn off automatic port selection and enter the port your proxy forwards to."
      : "Enter a whole port number from 1 to 65535.";
  if (field === "publicEndpoint")
    return "Enter a full http or https proxy address that other devices can reach, or leave it blank.";
  if (field === "webOrigins")
    return "Enter web app origins separated by commas, without paths or trailing slashes.";
  return undefined;
}

function AdvancedSettings({
  id,
  fields,
  onChange,
  invalid,
}: {
  id: string;
  fields: RemoteAccessEnableInput;
  onChange(value: Partial<RemoteAccessEnableInput>): void;
  invalid: PropertyKey | undefined;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${id}-automatic`}>Choose a port automatically</Label>
        <Switch
          id={`${id}-automatic`}
          checked={fields.listenPort === 0}
          onCheckedChange={(automatic) => onChange({ listenPort: automatic ? 0 : 14328 })}
        />
      </div>
      {fields.listenPort !== 0 ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-port`}>Fixed port</Label>
          <Input
            id={`${id}-port`}
            name="listenPort"
            type="number"
            min={1}
            max={65535}
            value={Number.isNaN(fields.listenPort) ? "" : fields.listenPort}
            onChange={(event) => onChange({ listenPort: event.target.valueAsNumber })}
            aria-invalid={invalid === "listenPort"}
            aria-describedby={`${id}-port-help`}
          />
          <p id={`${id}-port-help`} className="text-xs text-muted-foreground">
            Use a fixed port only if your firewall or proxy needs one.
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-host`}>Listen address</Label>
        <Input
          id={`${id}-host`}
          name="listenHost"
          value={fields.listenHost}
          onChange={(event) => onChange({ listenHost: event.target.value })}
          aria-invalid={invalid === "listenHost"}
          aria-describedby={`${id}-host-help`}
        />
        <p id={`${id}-host-help`} className="text-xs text-muted-foreground">
          Choose which network accepts connections. Use 0.0.0.0 for all IPv4 networks, or 127.0.0.1
          for a local proxy. These two addresses require a proxy URL below.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-endpoint`}>Proxy address</Label>
        <Input
          id={`${id}-endpoint`}
          name="publicEndpoint"
          type="url"
          placeholder="https://your-computer.example"
          value={fields.publicEndpoint ?? ""}
          onChange={(event) => onChange({ publicEndpoint: event.target.value || undefined })}
          aria-invalid={invalid === "publicEndpoint"}
          aria-describedby={`${id}-endpoint-help`}
        />
        <p id={`${id}-endpoint-help`} className="text-xs text-muted-foreground">
          Leave blank for a direct connection. If a proxy forwards connections to this host, enter
          its public URL.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-web-origins`}>Other web app URLs</Label>
        <Input
          id={`${id}-web-origins`}
          name="webOrigins"
          value={(fields.webOrigins ?? []).join(", ")}
          placeholder="https://my-openducktor.example"
          onChange={(event) =>
            onChange({
              webOrigins: event.target.value.trim()
                ? event.target.value.split(",").map((value) => value.trim())
                : [],
            })
          }
          aria-invalid={invalid === "webOrigins"}
          aria-describedby={`${id}-web-origins-help`}
        />
        <p id={`${id}-web-origins-help`} className="text-xs text-muted-foreground">
          Local browser clients, Electron, and app.openducktor.dev are allowed. Add other web app
          URLs here, separated by commas. Use only the scheme, hostname, and port.
        </p>
      </div>
    </div>
  );
}
