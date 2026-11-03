import { CODE_SLOTS } from "@openducktor/frontend-core/lib/pairing-code-selection";
import {
  REMOTE_PAIRING_CODE_LIFETIME_MS,
  type RemoteAccessBridge,
  type RemoteAccessState,
  type RemotePairingQr,
} from "@openducktor/contracts";
import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  CircleCheck,
  CircleStop,
  Copy,
  KeyRound,
  LoaderCircle,
  MonitorSmartphone,
  Plus,
  QrCode,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import {
  usePairingCountdown,
  usePairingWindow,
  type PairingWindowView,
} from "./use-pairing-window";
import { RemoteNetworkNotice } from "./remote-network-notice";

type PairingPanelProps = {
  bridge: RemoteAccessBridge;
  endpoint: string;
  pairing: RemoteAccessState["pairing"];
  pairingEnd: RemoteAccessState["pairingEnd"];
};

/**
 * Adds a device to the local host. The host opens a pairing window only on request, so a valid code
 * exists only while the operator waits for a device.
 */
export function PairingPanel({ bridge, endpoint, pairing, pairingEnd }: PairingPanelProps) {
  const pairingWindow = usePairingWindow(bridge, pairing, pairingEnd);
  const { view } = pairingWindow;
  if (view.kind === "start")
    return (
      <PairingStart
        outcome={view.outcome}
        pending={pairingWindow.starting}
        error={pairingWindow.error}
        onStart={pairingWindow.start}
      />
    );
  const current = view.pairing;
  const renewing = view.kind === "renewing";
  return (
    <section
      aria-label="Add a device"
      className="@container grid min-w-0 gap-5 rounded-xl border border-border bg-card p-5 shadow-xs"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h4 className="text-sm font-semibold text-foreground">Add a device</h4>
          <p className="text-xs text-muted-foreground">The code works for one device.</p>
        </div>
      </div>
      <Tabs defaultValue="code" className="min-w-0 gap-5">
        <TabsList aria-label="Pairing method" className="grid h-9 w-full grid-cols-2 @2xl:w-96">
          <TabsTrigger value="code">
            <KeyRound aria-hidden="true" className="size-3.5" />
            Enter a code
          </TabsTrigger>
          <TabsTrigger value="qr">
            <QrCode aria-hidden="true" className="size-3.5" />
            Scan a QR code
          </TabsTrigger>
        </TabsList>
        <TabsContent value="code" className="min-w-0">
          <ol className="grid gap-6">
            <PairingStep number={1} title="On the other device, enter this host address">
              <AddressField endpoint={endpoint} />
            </PairingStep>
            <PairingStep number={2} title="Then enter this code">
              <CodeField pairing={current} renewing={renewing} />
            </PairingStep>
          </ol>
        </TabsContent>
        <TabsContent value="qr" className="min-w-0">
          <div className="grid justify-items-center gap-4 text-center">
            <PairingQr
              payload={JSON.stringify({
                type: "openducktor-pairing",
                version: 1,
                endpoint,
                code: current.code,
              } satisfies RemotePairingQr)}
            />
            <div className="w-48">
              <PairingExpiry expiresAt={current.expiresAt} renewing={renewing} />
            </div>
            <div className="grid max-w-xs gap-1">
              <p className="text-sm font-medium text-foreground">
                Scan with the OpenDucktor mobile app
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                In the app, add a host and scan this code. It connects without typing.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      <RemoteNetworkNotice endpoint={endpoint} />
      {pairingWindow.error ? (
        <p role="alert" className="text-xs text-destructive-surface-foreground">
          {pairingWindow.error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p role="status" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden="true" className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Waiting for a device...
        </p>
        <Button
          type="button"
          variant="destructiveSoft"
          size="sm"
          disabled={pairingWindow.stopping}
          onClick={pairingWindow.stop}
        >
          {pairingWindow.stopping ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <CircleStop data-icon="inline-start" />
          )}
          Stop pairing
        </Button>
      </div>
    </section>
  );
}

const START_TEXT = {
  none: {
    title: "Add a phone or another computer",
    detail:
      "Get a one-time code that works for 5 minutes. A paired device can use this computer's workspaces, agents, and terminals.",
  },
  paired: {
    title: "Device paired",
    detail: "It is connected now and appears in Paired devices.",
  },
  refused: {
    title: "Pairing stopped after five wrong codes",
    detail: "Someone entered a wrong code five times. Add the device again to get a new code.",
  },
} as const;

function PairingStart({
  outcome,
  pending,
  error,
  onStart,
}: {
  outcome: Extract<PairingWindowView, { kind: "start" }>["outcome"];
  pending: boolean;
  error: string | undefined;
  onStart(): void;
}) {
  const text = START_TEXT[outcome ?? "none"];
  let icon = <MonitorSmartphone className="size-5" />;
  if (outcome === "paired") icon = <CircleCheck className="size-5" />;
  if (outcome === "refused") icon = <ShieldAlert className="size-5" />;
  return (
    <section
      aria-label="Add a device"
      className="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            outcome === null && "bg-muted text-muted-foreground",
            outcome === "paired" && "bg-success-surface text-success-icon",
            outcome === "refused" && "bg-warning-surface text-warning-muted",
          )}
        >
          {icon}
        </span>
        <div role="status" className="grid min-w-48 flex-1 gap-1">
          <p className="text-sm font-semibold text-foreground">{text.title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{text.detail}</p>
        </div>
        <Button
          type="button"
          variant={outcome === "paired" ? "outline" : "default"}
          disabled={pending}
          onClick={onStart}
        >
          {pending ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Plus data-icon="inline-start" />
          )}
          {outcome === "paired" ? "Add another device" : "Add device"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive-surface-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function PairingStep({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary dark:bg-primary/20 dark:text-primary-foreground"
      >
        {number}
      </span>
      <p className="self-center text-sm font-medium text-foreground">{title}</p>
      <div className="col-start-2 min-w-0 max-w-xl">{children}</div>
    </li>
  );
}

/** One tile per digit, in two groups, like the six slots that the other device shows. */
function PairingCode({ code, renewing }: { code: string; renewing: boolean }) {
  const tile = (position: number) => (
    <span
      key={position}
      className="flex h-12 min-w-0 max-w-11 flex-1 items-center justify-center rounded-lg border border-border bg-muted/50 font-mono text-2xl font-semibold text-foreground sm:h-14 sm:text-3xl"
    >
      {code[position]}
    </span>
  );
  return (
    <p
      className={cn(
        "flex min-w-0 max-w-80 flex-1 select-all items-center gap-1.5 transition-opacity sm:gap-2",
        renewing && "opacity-40",
      )}
    >
      {/* Screen readers read this text; the tiles show the same digits. */}
      <span className="sr-only">Pairing code {code.split("").join(" ")}</span>
      <span aria-hidden="true" className="contents">
        {CODE_SLOTS.slice(0, 3).map(tile)}
        <span className="mx-0.5 h-0.5 w-2.5 shrink-0 rounded-full bg-border sm:mx-1" />
        {CODE_SLOTS.slice(3).map(tile)}
      </span>
    </p>
  );
}

function AddressField({ endpoint }: { endpoint: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <p className="min-h-9 min-w-56 flex-1 select-all break-all rounded-md border border-input bg-muted/40 px-2.5 py-1.5 font-mono text-[0.8125rem] text-foreground">
          <span className="sr-only">Host address </span>
          {endpoint}
        </p>
        <CopyButton value={endpoint} name="address" onResult={setFailed} />
      </div>
      {failed ? <CopyFailure name="address" /> : null}
    </div>
  );
}

function CodeField({
  pairing,
  renewing,
}: {
  pairing: NonNullable<RemoteAccessState["pairing"]>;
  renewing: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <PairingCode code={pairing.code} renewing={renewing} />
        <CopyButton value={pairing.code} name="pairing code" onResult={setFailed} />
      </div>
      {failed ? <CopyFailure name="pairing code" /> : null}
      <PairingExpiry expiresAt={pairing.expiresAt} renewing={renewing} />
    </div>
  );
}

function CopyButton({
  value,
  name,
  onResult,
}: {
  value: string;
  name: "address" | "pairing code";
  /** Receives true when the copy failed. */
  onResult(failed: boolean): void;
}) {
  const { copied, copyToClipboard } = useCopyToClipboard({
    successMessage: name === "address" ? "Host address copied" : "Pairing code copied",
    copyFailedDescription: `Select the ${name} and copy it manually.`,
  });
  return (
    <Button
      type="button"
      variant="outline"
      className="w-24 shrink-0"
      aria-label={copied ? `Copied ${name}` : `Copy ${name}`}
      title={copied ? "Copied" : `Copy ${name}`}
      onClick={() => {
        void copyToClipboard(value).then((success) => onResult(!success));
      }}
    >
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function CopyFailure({ name }: { name: string }) {
  return (
    <p role="alert" className="text-xs text-destructive-surface-foreground">
      Could not copy the {name}. Select it and copy it.
    </p>
  );
}

/**
 * A bar that empties over the code lifetime, with the minutes and seconds left. It owns the
 * one-second clock, so a tick renders only the bar.
 */
function PairingExpiry({ expiresAt, renewing }: { expiresAt: string; renewing: boolean }) {
  const countdown = usePairingCountdown(expiresAt);
  const remainingMs = renewing ? 0 : countdown;
  const seconds = Math.ceil(remainingMs / 1000);
  const ending = seconds <= 60;
  return (
    <div className="grid gap-1.5">
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none",
            ending ? "bg-warning-accent" : "bg-primary",
          )}
          style={{ width: `${(remainingMs / REMOTE_PAIRING_CODE_LIFETIME_MS) * 100}%` }}
        />
      </div>
      <span
        role="timer"
        aria-label="Pairing code time remaining"
        aria-live="off"
        className={cn(
          "text-xs tabular-nums",
          ending ? "text-warning-muted" : "text-muted-foreground",
        )}
      >
        {remainingMs > 0
          ? `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
          : "Getting a new code..."}
      </span>
    </div>
  );
}

function PairingQr({ payload }: { payload: string }) {
  const [result, setResult] = useState<{ payload: string; image?: string; error?: string } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    void import("qrcode")
      .then(({ toDataURL }) => toDataURL(payload, { width: 320, margin: 2 }))
      .then((image) => {
        if (!cancelled) setResult({ payload, image });
      })
      .catch(() => {
        if (!cancelled) setResult({ payload, error: "QR code unavailable. Use the code instead." });
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);
  // A rotated code must never show the QR of the previous code.
  const current = result?.payload === payload ? result : null;
  let content: ReactNode;
  if (current?.image)
    content = (
      <img
        className="size-full [image-rendering:pixelated]"
        src={current.image}
        alt="QR code to pair with this host"
      />
    );
  else if (current?.error)
    content = (
      <p role="status" className="text-center text-xs text-muted-foreground">
        {current.error}
      </p>
    );
  else
    content = (
      <span role="status" aria-label="Creating QR code" className="text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </span>
    );
  return (
    <div
      className={cn(
        "flex size-48 shrink-0 items-center justify-center rounded-lg border border-border p-2",
        current?.image ? "bg-white" : "bg-muted/40",
      )}
    >
      {content}
    </div>
  );
}
