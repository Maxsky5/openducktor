import { REMOTE_HTTP_DETAILS, REMOTE_HTTP_WARNING } from "@openducktor/contracts";
import { ChevronDown, ShieldAlert } from "lucide-react";

export function RemoteNetworkNotice({ endpoint }: { endpoint: string }) {
  if (!endpoint.startsWith("http://")) return null;
  return (
    <details className="group rounded-md bg-muted/50 text-xs leading-relaxed text-foreground/80">
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{REMOTE_HTTP_WARNING}</span>
        <ChevronDown
          className="mt-0.5 size-3.5 shrink-0 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <p className="px-3 pb-3 pl-8">{REMOTE_HTTP_DETAILS}</p>
    </details>
  );
}
