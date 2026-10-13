import { useId, useState, type FormEvent } from "react";
import { LoaderCircle, Monitor, Server, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { localHostLabel, parseHostEndpoint, type HostSelection } from "@/lib/host-location";
import { cn } from "@/lib/utils";

type Action = "connect" | "local" | "disconnect";

export function HostPicker({
  selection,
  error: initialError,
  onCancel,
}: {
  selection: HostSelection;
  error?: string | undefined;
  onCancel?: () => void;
}) {
  const { target } = selection;
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState<{ action: Action; message: string } | null>(
    initialError ? { action: "connect", message: initialError } : null,
  );
  const [pending, setPending] = useState<Action | null>(null);
  const currentHost = target.kind !== "picker";
  const Body = onCancel ? DialogBody : "div";
  const Footer = onCancel ? DialogFooter : "div";
  const run = async (action: Action, work: () => Promise<void>) => {
    setPending(action);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError({ action, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setPending(null);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run("connect", async () => {
      const address = parseHostEndpoint(endpoint, window.location.protocol);
      if (target.kind === "remote" && address === target.endpoint) {
        throw new Error("This host is already selected. Enter a different address.");
      }
      await selection.select(address);
    });
  };

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <fieldset disabled={pending !== null} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Body
          className={cn("flex min-h-0 flex-col gap-5", onCancel && "overflow-y-auto px-6 py-5")}
        >
          {currentHost ? <SelectedHost selection={selection} /> : null}
          {error && error.action !== "connect" ? (
            <p role="alert" className="text-sm text-destructive-surface-foreground">
              {error.message}
            </p>
          ) : null}
          <HostAddressFields
            currentHost={currentHost}
            value={endpoint}
            onChange={(value) => {
              setEndpoint(value);
              setError(null);
            }}
            error={error?.action === "connect" ? error.message : undefined}
          />
        </Body>
        <Footer
          role="group"
          aria-label="Connection actions"
          className={
            onCancel
              ? "mt-0 flex-wrap-reverse items-end justify-between gap-3 border-t border-border px-6 py-4"
              : "mt-5"
          }
        >
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <div className={cn("flex gap-2", onCancel ? "flex-wrap justify-end" : "flex-col")}>
            <HostActions selection={selection} pending={pending} run={run} />
            <Button type="submit" disabled={!endpoint.trim()}>
              {pending === "connect" ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : null}
              {pending === "connect"
                ? "Connecting…"
                : currentHost
                  ? "Switch host"
                  : "Connect to host"}
            </Button>
          </div>
        </Footer>
      </fieldset>
    </form>
  );
}

function SelectedHost({ selection }: { selection: HostSelection }) {
  const { target } = selection;
  const Icon = target.kind === "remote" ? Server : Monitor;
  return (
    <dl className="flex items-center gap-3">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-xs text-muted-foreground">Selected host</dt>
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
  pending: Action | null;
  run(action: Action, work: () => Promise<void>): Promise<void>;
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
            <Monitor data-icon="inline-start" />
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

function HostAddressFields({
  currentHost,
  value,
  onChange,
  error,
}: {
  currentHost: boolean;
  value: string;
  onChange(value: string): void;
  error: string | undefined;
}) {
  const id = useId();
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-address`}>{currentHost ? "New host address" : "Host address"}</Label>
        <Input
          id={`${id}-address`}
          type="url"
          inputMode="url"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="https://host.example"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          onChange={(event) => onChange(event.target.value)}
        />
        <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
          Copy the address from Settings, Remote control on the host.
        </p>
        {error ? (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-sm text-destructive-surface-foreground"
          >
            {error}
          </p>
        ) : null}
      </div>
      {currentHost ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Copy unsent drafts before changing hosts.
        </p>
      ) : null}
    </>
  );
}
