import { useId, useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
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
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [pending, setPending] = useState<"copy" | "qr" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    setPending("copy");
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setError(null);
    } catch {
      setError("Could not copy the address. Select the address below and copy it.");
    } finally {
      setPending(null);
    }
  };
  const showQr = async () => {
    setPending("qr");
    try {
      const { toDataURL } = await import("qrcode");
      setQr(await toDataURL(endpoint, { width: 256, margin: 4 }));
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
        {error ? (
          <p role="alert" className="text-sm text-destructive-surface-foreground">
            {error}
          </p>
        ) : null}
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Host address</DialogTitle>
            <DialogDescription>
              This QR code contains the host address. Scan it with an OpenDucktor client.
            </DialogDescription>
          </DialogHeader>
          {qr ? (
            <img
              className="mx-auto"
              src={qr}
              width={256}
              height={256}
              alt={`Host address QR code: ${endpoint}`}
            />
          ) : null}
          <code className="select-all break-all text-xs text-foreground">{endpoint}</code>
        </DialogContent>
      </div>
    </Dialog>
  );
}
