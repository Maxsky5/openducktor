import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import type { ShellBridge } from "@/lib/shell-bridge";

export const CONNECTION_TOASTER_ID = "host-connection";

export function HostRetryButton({
  connection,
  disabled,
  className,
}: {
  connection: NonNullable<ShellBridge["remoteConnection"]>;
  disabled: boolean;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const retry = async () => {
    setPending(true);
    try {
      // Wait on fast failures without delaying the host's connected state.
      const [result] = await Promise.allSettled([
        connection.retry(),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
      if (result.status === "rejected") {
        toast.error("Could not reconnect to host", {
          id: "host-connection-retry",
          toasterId: CONNECTION_TOASTER_ID,
          description: errorMessage(result.reason),
        });
      }
    } finally {
      setPending(false);
    }
  };
  const busy = pending || disabled;
  return (
    <Button disabled={busy} className={className} onClick={() => void retry()}>
      {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
      {pending ? "Retrying…" : disabled ? "Connecting…" : "Retry connection"}
    </Button>
  );
}
