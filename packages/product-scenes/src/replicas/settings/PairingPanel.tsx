// Add a device of the Remote control settings, as pairing-panel.tsx in
// packages/frontend/src/components/features/remote-control. Before a pairing window, a card offers
// Add device. The open window has two tabs: Enter a code shows the host address and the code, and
// Scan a QR code shows the QR code with the address and the code. After a device pairs, the card
// says so. A scene changes `data-pairing` of the root and `data-tab` of the panel.
import {
  CircleCheck,
  CircleStop,
  Copy,
  KeyRound,
  MonitorSmartphone,
  Plus,
  QrCode as QrIcon,
  ShieldAlert,
  ChevronDown,
} from "lucide-react";
import type { ReactElement } from "react";
import { QrCode } from "../ui/QrCode";
import { Button } from "../ui/Button";
import { REMOTE_HTTP_WARNING } from "./remote-control-text";
import "./PairingPanel.css";

export type PairingView = "start" | "open" | "paired";

type PairingPanelProps = {
  view: PairingView;
  tab: "code" | "qr";
  endpoint: string;
  code: string;
  /** The time left of the code, such as 4:12. */
  expires: string;
  /** The part of the lifetime of the code that is left, in percent. */
  left: number;
  qr: readonly string[];
};

/** The card before a pairing window, or after a device paired. */
function StartCard({ paired }: { paired: boolean }): ReactElement {
  return (
    <section className="rc-card rc-start" data-for={paired ? "paired" : "start"}>
      <span className="rc-start-icon" data-paired={paired ? "" : undefined}>
        {paired ? <CircleCheck /> : <MonitorSmartphone />}
      </span>
      <span className="rc-start-text">
        <strong>{paired ? "Device paired" : "Add a phone or another computer"}</strong>
        <span>
          {paired
            ? "It is connected now and appears in Paired devices."
            : "Get a one-time code that works for 5 minutes. A paired device can use this computer's workspaces, agents, and terminals."}
        </span>
      </span>
      <Button variant={paired ? "outline" : "default"} data-add-device={paired ? undefined : ""}>
        <Plus className="i16" />
        {paired ? "Add another device" : "Add device"}
      </Button>
    </section>
  );
}

function Expiry({ expires, left }: { expires: string; left: number }): ReactElement {
  return (
    <span className="rc-expiry">
      <span className="rc-expiry-bar">
        <i style={{ width: `${left}%` }} />
      </span>
      <span>Expires in {expires}</span>
    </span>
  );
}

function CopyButton(): ReactElement {
  return (
    <Button variant="outline" className="rc-copy">
      <Copy className="i16" />
      Copy
    </Button>
  );
}

export function PairingPanel({
  view,
  tab,
  endpoint,
  code,
  expires,
  left,
  qr,
}: PairingPanelProps): ReactElement {
  return (
    <div className="rc-pairing" data-pairing={view}>
      <StartCard paired={false} />
      <StartCard paired />
      <section className="rc-card rc-panel" data-for="open" data-tab={tab} data-pairing-panel="">
        <span className="rc-panel-head">
          <strong>Add a device</strong>
          <span>The code works for one device.</span>
        </span>
        <span className="rc-tabs">
          <span className="rc-tab" data-tab-trigger="code">
            <KeyRound />
            Enter a code
          </span>
          <span className="rc-tab" data-tab-trigger="qr">
            <QrIcon />
            Scan a QR code
          </span>
        </span>
        <ol className="rc-code-tab">
          <li>
            <span className="rc-step-number">1</span>
            <span className="rc-step-title">On the other device, enter this host address</span>
            <span className="rc-step-body">
              <span className="rc-address">{endpoint}</span>
              <CopyButton />
            </span>
          </li>
          <li>
            <span className="rc-step-number">2</span>
            <span className="rc-step-title">Then enter this code</span>
            <span className="rc-step-body rc-step-stack">
              <span className="rc-code-row">
                <span className="rc-code">
                  {[...code].map((digit, index) => (
                    // The digits of a code never move, so the index is a stable key.
                    <span
                      key={index}
                      className="rc-code-tile"
                      data-group={index === 3 ? "" : undefined}
                    >
                      {digit}
                    </span>
                  ))}
                </span>
                <CopyButton />
              </span>
              <Expiry expires={expires} left={left} />
            </span>
          </li>
        </ol>
        <span className="rc-qr-tab">
          <span className="rc-qr-box" data-qr="">
            <QrCode rows={qr} className="rc-qr" />
          </span>
          <Expiry expires={expires} left={left} />
          <span className="rc-qr-text">
            <strong>Scan with the OpenDucktor mobile app</strong>
            <span>In the app, add a host and scan this code. It connects without typing.</span>
          </span>
        </span>
        <span className="rc-notice">
          <ShieldAlert />
          <span>{REMOTE_HTTP_WARNING}</span>
          <ChevronDown />
        </span>
        <span className="rc-panel-foot">
          <span className="rc-waiting">
            <i />
            Waiting for a device...
          </span>
          <Button size="sm" className="rc-stop">
            <CircleStop className="i16" />
            Stop pairing
          </Button>
        </span>
      </section>
    </div>
  );
}
