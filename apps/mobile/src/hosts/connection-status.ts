import type { StatusPillVariant } from "@/ui/status-pill";
import { type ConnectionPhase, connectionCopy } from "@/host-session/connection-phase";

/** The words and colors of a connection status pill. */
export type ConnectionPill = { label: string; variant: StatusPillVariant; busy: boolean };

/**
 * The status pill of a connection phase, in the desktop badge colors: green when connected, a
 * loader while the app connects, amber while it waits, and red when it stopped.
 */
export const connectionPhasePill = (phase: ConnectionPhase, hostLabel: string): ConnectionPill => {
  const copy = connectionCopy(phase, hostLabel);
  if (phase.kind === "connected") return { label: copy.status, variant: "success", busy: false };
  if (copy.busy) return { label: copy.status, variant: "secondary", busy: true };
  return {
    label: copy.status,
    variant: copy.tone === "destructive" ? "danger" : "warning",
    busy: false,
  };
};

/** The host and port of an address, without the scheme, so a row stays short. */
export const hostAddress = (endpoint: string): string => new URL(endpoint).host;
