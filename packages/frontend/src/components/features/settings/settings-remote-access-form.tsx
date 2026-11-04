import { useId, useState, type Ref } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import type { RemoteAccessEnableInput } from "@openducktor/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NetworkChoice } from "@/components/features/remote-control/network-choice";
import type { RemoteAccessSetup } from "@/state/operations/remote-access";

/**
 * The listener of the local host. While Remote control is off, the enable switch submits this form.
 * While it is on, Apply restarts the listener with the changed fields.
 */
export function RemoteAccessForm({
  setup,
  ref,
  onClose,
}: {
  setup: RemoteAccessSetup;
  ref?: Ref<HTMLFormElement>;
  /** Closes the form without applying its changes. */
  onClose?: (() => void) | undefined;
}) {
  const id = useId();
  const [submitted, setSubmitted] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const { fields, networks, pending, change, parsed } = setup;
  const issue = submitted && !parsed.success ? parsed.error.issues[0] : undefined;
  const invalid = issue?.path[0];
  const error = fieldError(invalid);
  return (
    <form
      ref={ref}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (parsed.success) {
          setup.enable(parsed.data);
          return;
        }
        const form = event.currentTarget;
        const name = String(parsed.error.issues[0]?.path[0]);
        const focus = () => {
          const input = form.elements.namedItem(name);
          if (input instanceof HTMLInputElement) input.focus();
          else form.querySelector<HTMLButtonElement>('[role="radio"]')?.focus();
        };
        if (name !== "listenHost" || !networks.length) {
          setAdvanced(true);
          requestAnimationFrame(focus);
        } else focus();
      }}
    >
      <fieldset disabled={pending} className="grid min-w-0 gap-3">
        <NetworkChoice
          networks={networks}
          value={fields.listenHost}
          onChange={(listenHost) => change({ listenHost, publicEndpoint: undefined })}
          onRefresh={setup.refreshNetworks}
          refreshing={setup.refreshingNetworks}
          disabled={pending}
          invalid={invalid === "listenHost"}
          errorId={`${id}-error`}
        />
        {error && !advanced ? (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-xs text-destructive-surface-foreground"
          >
            {error}
          </p>
        ) : null}
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 justify-start px-2 text-muted-foreground"
            >
              <ChevronDown
                data-icon="inline-start"
                className={advanced ? "rotate-180" : undefined}
              />
              Advanced
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <AdvancedSettings id={id} fields={fields} onChange={change} invalid={invalid} />
          </CollapsibleContent>
        </Collapsible>
        {setup.status === "available" ? (
          <div className="flex justify-end gap-2">
            {onClose ? (
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!setup.changed}>
              {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {pending ? "Applying..." : "Apply changes"}
            </Button>
          </div>
        ) : null}
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
    <div className="grid gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-host`}>Local listen address</Label>
          <Input
            id={`${id}-host`}
            name="listenHost"
            value={fields.listenHost}
            onChange={(event) => onChange({ listenHost: event.target.value })}
            aria-invalid={invalid === "listenHost"}
            aria-describedby={`${id}-host-help`}
            className="font-mono text-xs aria-invalid:border-destructive-border"
          />
          <AdvancedFieldError id={id} field="listenHost" invalid={invalid} />
        </div>
        <div className="grid gap-1.5">
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
            aria-describedby={invalid === "listenPort" ? `${id}-error` : undefined}
            className="font-mono text-xs aria-invalid:border-destructive-border"
          />
          <AdvancedFieldError id={id} field="listenPort" invalid={invalid} />
        </div>
        <p
          id={`${id}-host-help`}
          className="col-span-2 text-xs leading-relaxed text-muted-foreground"
        >
          0.0.0.0 listens on all IPv4 networks; 127.0.0.1 is local only. Both need a public host
          address.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-endpoint`}>Public host address</Label>
        <Input
          id={`${id}-endpoint`}
          name="publicEndpoint"
          type="url"
          placeholder="https://host.example"
          value={fields.publicEndpoint ?? ""}
          onChange={(event) => onChange({ publicEndpoint: event.target.value || undefined })}
          aria-invalid={invalid === "publicEndpoint"}
          aria-describedby={`${id}-endpoint-help`}
          className="font-mono text-xs aria-invalid:border-destructive-border"
        />
        <AdvancedFieldError id={id} field="publicEndpoint" invalid={invalid} />
        <p id={`${id}-endpoint-help`} className="text-xs text-muted-foreground">
          Optional. Use a public URL if you have set up a reverse proxy.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-web-origins`}>Other web clients</Label>
        <Input
          id={`${id}-web-origins`}
          name="webOrigins"
          value={(fields.webOrigins ?? []).join(", ")}
          placeholder="https://my-client.example"
          onChange={(event) =>
            onChange({
              webOrigins: event.target.value.trim()
                ? event.target.value.split(",").map((value) => value.trim())
                : [],
            })
          }
          aria-invalid={invalid === "webOrigins"}
          aria-describedby={`${id}-web-origins-help`}
          className="font-mono text-xs aria-invalid:border-destructive-border"
        />
        <AdvancedFieldError id={id} field="webOrigins" invalid={invalid} />
        <p id={`${id}-web-origins-help`} className="text-xs leading-relaxed text-muted-foreground">
          Additional allowed origins, separated by commas. Local clients and app.openducktor.dev are
          already allowed.
        </p>
      </div>
    </div>
  );
}

function AdvancedFieldError({
  id,
  field,
  invalid,
}: {
  id: string;
  field: string;
  invalid: PropertyKey | undefined;
}) {
  if (field !== invalid) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-xs text-destructive-surface-foreground">
      {fieldError(invalid)}
    </p>
  );
}
