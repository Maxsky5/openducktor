// The form that adds a host, as add-host-form.tsx in apps/mobile/src/hosts. The address step
// shows Scan QR code, the divider, the Host address field, and Continue. A scanned pairing QR code
// fills the address and the code, so the form goes to the pairing step and connects at once:
// Connecting to, the six code slots, Cancel, and Connecting…. A scene changes `data-host-step`.
import { ArrowRight, ChevronDown, Info, LoaderCircle, QrCode, Server } from "lucide-react";
import type { ReactElement } from "react";
import { REMOTE_HTTP_WARNING } from "../settings/remote-control-text";
import "./HostForm.css";

/** The help under the address field, for a phone that cannot copy from the host. */
export const ADDRESS_HINT =
  "On your computer, open Remote control and select Add device. It shows the address.";

/** The text of the scan card. */
export const SCAN_CARD = {
  title: "Scan QR code",
  detail: "On your computer, open Remote control, select Add device, then Scan a QR code.",
} as const;

type HostFormProps = {
  step: "address" | "pairing";
  /** The address and the code of the scanned QR code. */
  endpoint: string;
  code: string;
};

/**
 * The pairing step: the address, the code that the QR code gave, and the connection that runs.
 * Change is disabled while the form connects.
 */
function PairingStep({ endpoint, code }: { endpoint: string; code: string }): ReactElement {
  return (
    <div className="mob-host-pairing">
      <div className="mob-host-destination">
        <span className="mob-host-destination-text">
          <span className="mob-host-muted">Connecting to</span>
          <span className="mob-host-mono">{endpoint}</span>
        </span>
        <span className="mob-host-change">Change</span>
      </div>
      <p className="mob-host-secondary">Enter the code that Add device shows on your computer.</p>
      <div className="mob-field">
        <span className="mob-field-label">Pairing code</span>
        <span className="mob-code">
          {[...code].map((digit, index) => (
            // The digits of a code never move, so the index is a stable key.
            <span key={index} className="mob-code-slot" data-group={index === 3 ? "" : undefined}>
              {digit}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

export function HostForm({ step, endpoint, code }: HostFormProps): ReactElement {
  return (
    <div className="mob-host-form" data-host-step={step}>
      <div className="mob-host-address">
        <span className="mob-scan" data-scan="">
          <span className="mob-scan-tile">
            <QrCode />
          </span>
          <span className="mob-scan-text">
            <span className="mob-scan-title">{SCAN_CARD.title}</span>
            <span className="mob-host-muted">{SCAN_CARD.detail}</span>
          </span>
          <ArrowRight className="mob-scan-arrow" />
        </span>
        <span className="mob-divider">
          <i />
          or enter the address
          <i />
        </span>
        <div className="mob-field">
          <span className="mob-field-label">Host address</span>
          <span className="mob-field-input">http://192.168.1.20:14328</span>
          <span className="mob-host-muted mob-field-hint">{ADDRESS_HINT}</span>
        </div>
      </div>
      <PairingStep endpoint={endpoint} code={code} />
      <div className="mob-host-actions">
        <span className="mob-button" data-variant="outline" data-for="pairing">
          Cancel
        </span>
        <span className="mob-button" data-variant="filled" data-for="address" data-disabled="">
          <Server />
          Continue
        </span>
        <span className="mob-button" data-variant="filled" data-for="pairing">
          <LoaderCircle className="spin" />
          Connecting…
        </span>
      </div>
      <div className="mob-host-notice" data-for="pairing">
        <Info />
        <span>{REMOTE_HTTP_WARNING}</span>
        <ChevronDown className="mob-host-notice-chevron" />
      </div>
    </div>
  );
}
