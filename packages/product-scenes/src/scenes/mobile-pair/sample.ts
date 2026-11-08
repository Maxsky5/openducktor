// The sample data of the pairing scene: the address, the code, and the QR code of the host, the
// countdown of the code, and the toast of the phone when it connects. Sources: pairing-panel.tsx
// in packages/frontend/src/components/features/remote-control, add-host-form.tsx in
// apps/mobile/src/hosts, and REMOTE_PAIRING_CODE_LIFETIME_MS of packages/contracts.
import { PAIRING_CODE_LIFETIME_MS } from "../../replicas/settings/remote-control-text";
import { HOST_LABEL } from "../../sample/mobile";

/** The toast of add-host-form.tsx: the saved host has the host name of its address as its label. */
export const CONNECTED = { message: "Connected to host", description: HOST_LABEL } as const;

/** The seconds of the code lifetime that are left when the window opens. */
export const OPENED_LEFT = PAIRING_CODE_LIFETIME_MS / 1000 - 1;

/** The time left of a code, as PairingExpiry shows it, and the width of its bar in percent. */
export type Expiry = { text: string; left: number };

/** The time left of the code with `seconds` left. */
export function expiry(seconds: number): Expiry {
  const total = PAIRING_CODE_LIFETIME_MS / 1000;
  return {
    text: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    left: (seconds / total) * 100,
  };
}
