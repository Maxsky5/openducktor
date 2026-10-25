import { useId, useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

export function RemoteAddress({
  endpoint,
  connectedClients,
}: {
  endpoint: string;
  connectedClients: number;
}) {
  const id = useId();
  const clients = connectedClients === 1 ? "client" : "clients";
  const status =
    connectedClients === 0 ? "No clients connected" : `${connectedClients} ${clients} connected`;
  const [open, setOpen] = useState(false);
  // Keep the copied address, so a new address shows the copy action again.
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const copied = copiedEndpoint === endpoint;
  const [qr, setQr] = useState<string | null>(null);
  const [pending, setPending] = useState<"copy" | "qr" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    setPending("copy");
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopiedEndpoint(endpoint);
      setError(null);
    } catch {
      setError("Could not copy the address. Select the address and copy it.");
    } finally {
      setPending(null);
    }
  };
  const showQr = async () => {
    setPending("qr");
    try {
      const { toDataURL } = await import("qrcode");
      // Two pixels for each display point keep the code sharp on a high-density screen. The frame
      // around the image adds the rest of the quiet zone.
      setQr(await toDataURL(endpoint, { width: 448, margin: 1 }));
      setOpen(true);
      setError(null);
    } catch (cause) {
      setError(
        `Could not create the QR code: ${cause instanceof Error ? cause.message : String(cause)}. Copy the address instead.`,
      );
    } finally {
      setPending(null);
    }
  };
  // The open dialog hides the page, so it shows the error itself.
  const errorAlert = error ? (
    <p role="alert" className="text-sm text-destructive-surface-foreground">
      {error}
    </p>
  ) : null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="grid gap-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={id}>Host address</Label>
          <p role="status" className="text-xs text-muted-foreground">
            {status}
          </p>
        </div>
        <Input
          id={id}
          readOnly
          value={endpoint}
          className="min-w-0 font-mono text-xs read-only:text-foreground"
          onFocus={(event) => event.target.select()}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending !== null}
            onClick={() => {
              void copy();
            }}
          >
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy address"}
          </Button>
          <DialogTrigger
            asChild
            onClick={(event) => {
              // Wait for the QR image before opening the dialog.
              event.preventDefault();
              void showQr();
            }}
          >
            <Button type="button" variant="outline" size="sm" disabled={pending !== null}>
              <QrCode data-icon="inline-start" />
              {pending === "qr" ? "Creating QR code..." : "Show QR code"}
            </Button>
          </DialogTrigger>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste this address in Host connection on your other device.
        </p>
        {open ? null : errorAlert}
        <DialogContent className="max-w-sm">
          <DialogHeader className="pr-8">
            <DialogTitle>Host address</DialogTitle>
            <DialogDescription>
              Scan this QR code with the OpenDucktor mobile app to connect it to this host.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="mt-6 flex flex-col items-center gap-5">
            {qr ? (
              // The white frame is the quiet zone that a scanner needs, also in the dark theme.
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-border">
                <img
                  className="block size-56 [image-rendering:pixelated]"
                  src={qr}
                  alt={`Host address QR code: ${endpoint}`}
                />
              </div>
            ) : null}
            <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 py-1.5 pl-3 pr-1.5">
              <code className="min-w-0 flex-1 select-all truncate font-mono text-xs text-foreground">
                {endpoint}
              </code>
              <CopyIconButton
                copied={copied}
                ariaLabel="Copy host address"
                tooltipLabel={copied ? "Copied" : "Copy address"}
                onClick={() => {
                  void copy();
                }}
              />
            </div>
            {errorAlert}
          </DialogBody>
        </DialogContent>
      </div>
    </Dialog>
  );
}
