import { useEffect, useRef, useState } from "react";
import type {
  RemoteAccessBridge,
  RemoteAccessState,
  RemotePairingEnd,
} from "@openducktor/contracts";
import { useRemoteAccessPairing } from "@/state/operations/remote-access";

type Pairing = NonNullable<RemoteAccessState["pairing"]>;

/** What the pairing view shows. */
export type PairingWindowView =
  | { kind: "start"; outcome: Extract<RemotePairingEnd, "paired" | "refused"> | null }
  | { kind: "open"; pairing: Pairing }
  | { kind: "renewing"; pairing: Pairing };

/**
 * Follows the pairing window of the host for one view. While the view stays open, an expired code
 * gets a new one at once, and the old code stays on screen until the new one arrives. The host says
 * why a window closed, so only an expiry renews it.
 */
export function usePairingWindow(
  bridge: RemoteAccessBridge,
  pairing: RemoteAccessState["pairing"],
  pairingEnd: RemotePairingEnd | undefined,
) {
  const actions = useRemoteAccessPairing(bridge);
  // The last code that this view showed. Another view or an earlier session does not count.
  const [shown, setShown] = useState(pairing);
  if (pairing && pairing !== shown) setShown(pairing);
  // Stop pairing hides its code at once, before the host confirms.
  const [stoppedCode, setStoppedCode] = useState<string | null>(null);
  const visible = shown && shown.code !== stoppedCode ? shown : null;
  // The countdown ticks in the expiry bar. This view only needs the moment of expiry.
  const expired = useExpired(visible?.expiresAt);
  const view = pairingWindowView({
    visible,
    open: pairing !== null,
    pairingEnd,
    expired,
    renewalFailed: actions.startFailed,
  });
  const renewingCode = view.kind === "renewing" ? view.pairing.code : null;
  const renewedCode = useRef<string | null>(null);
  const { renew } = actions;
  useEffect(() => {
    if (!renewingCode || renewedCode.current === renewingCode) return;
    renewedCode.current = renewingCode;
    renew();
  }, [renewingCode, renew]);
  return {
    view,
    start: actions.start,
    stop: () => {
      if (visible) setStoppedCode(visible.code);
      actions.stop();
    },
    starting: actions.starting,
    stopping: actions.stopping,
    error: actions.error,
  };
}

/**
 * Chooses the view from the last shown code, whether the host has a window open, and why the host
 * closed the last one. Only an expiry of a shown code renews it.
 */
function pairingWindowView(input: {
  visible: Pairing | null;
  open: boolean;
  pairingEnd: RemotePairingEnd | undefined;
  expired: boolean;
  renewalFailed: boolean;
}): PairingWindowView {
  const { visible, open, pairingEnd } = input;
  if (!visible) return { kind: "start", outcome: null };
  const expired = open ? input.expired : pairingEnd === "expired";
  if (open && !expired) return { kind: "open", pairing: visible };
  if (expired && !input.renewalFailed) return { kind: "renewing", pairing: visible };
  const outcome = pairingEnd === "paired" || pairingEnd === "refused" ? pairingEnd : null;
  return { kind: "start", outcome: open ? null : outcome };
}

/** True once `expiresAt` passes, with one timer at the deadline. */
function useExpired(expiresAt: string | undefined): boolean {
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => setExpiredAt(expiresAt),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return expiresAt !== undefined && expiredAt === expiresAt;
}

/** Counts down to `expiresAt` each second. The host state supplies each new code. */
export function usePairingCountdown(expiresAt: string): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const deadline = Date.parse(expiresAt);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current < deadline) timer = setTimeout(tick, Math.min(1000, deadline - current));
    };
    tick();
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return Math.max(0, Date.parse(expiresAt) - now);
}
