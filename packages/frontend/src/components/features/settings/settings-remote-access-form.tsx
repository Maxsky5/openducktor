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
  const [advanced, setAdvanced] = useState(fields.publicEndpoint !== undefined);
  const parsed = remoteAccessEnableInputSchema.safeParse(fields);
  const issue = submitted && !parsed.success ? parsed.error.issues[0] : undefined;
  const invalid = issue?.path[0];
  const error = fieldError(invalid);
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
          Select a network shared with your other device. The address stays the same after a
          restart.
        </p>
        <RadioGroup
          value={selected ? fields.listenHost : ""}
          onValueChange={(listenHost) => onChange({ listenHost, publicEndpoint: undefined })}
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
        <div>
          <Collapsible
            open={advanced}
            onOpenChange={setAdvanced}
            className="border-t border-border"
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start rounded-none py-4 focus-visible:ring-inset"
              >
                <ChevronDown
                  data-icon="inline-start"
                  className={advanced ? "rotate-180" : undefined}
                />{" "}
                Advanced
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pb-4 pt-3">
              <AdvancedSettings id={id} fields={fields} onChange={onChange} invalid={invalid} />
            </CollapsibleContent>
          </Collapsible>
          {error ? (
            <p role="alert" className="py-4 text-sm text-destructive-surface-foreground">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
            <Button type="submit" disabled={status === "available" && !changed}>
              {pending ? "Updating remote control..." : label}
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}

function fieldError(field: PropertyKey | undefined): string | undefined {
  if (field === "listenHost")
    return "Choose a network, or enter a public host address in Advanced.";
  if (field === "listenPort") return "Enter a whole port number from 1 to 65535.";
  if (field === "publicEndpoint") return "Enter a full http or https host URL, or leave it blank.";
  if (field === "webOrigins")
    return "Enter web client URLs separated by commas, with no path or trailing slash.";
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
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-port`}>Port</Label>
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
          Your devices connect on this port. OpenDucktor keeps it after a restart.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-host`}>Local listen address</Label>
        <Input
          id={`${id}-host`}
          name="listenHost"
          value={fields.listenHost}
          onChange={(event) => onChange({ listenHost: event.target.value })}
          aria-invalid={invalid === "listenHost"}
          aria-describedby={`${id}-host-help`}
        />
        <p id={`${id}-host-help`} className="text-xs text-muted-foreground">
          This computer's IP address. Use 0.0.0.0 for all IPv4 networks or 127.0.0.1 for local
          connections. Both need a public host address below.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-endpoint`}>Public host address</Label>
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
          The address clients use, for Copy, QR, and request checks. Leave blank for direct access.
          Set up any proxy separately.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-web-origins`}>Other web clients</Label>
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
          Allow other web clients to use this host. Enter URLs separated by commas, with no path or
          trailing slash. Local clients and app.openducktor.dev already work.
        </p>
      </div>
    </div>
  );
}
