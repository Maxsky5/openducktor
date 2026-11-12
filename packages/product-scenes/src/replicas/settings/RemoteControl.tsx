// The Remote control section of the Settings dialog, cropped to its content, as
// settings-remote-access-section.tsx, pairing-panel.tsx, and paired-devices.tsx in
// packages/frontend/src/components. Remote control is on: the switch row, Add a device, the
// paired devices, and the Network section. A scene changes `data-pairing`, `data-tab`, and
// `data-devices`, and the text of `data-switch-status`.
import { Smartphone, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { PairingPanel, type PairingView } from "./PairingPanel";
import "./RemoteControl.css";

/** The status under the switch, as remoteControlSwitchDescription with 0 or 1 device. */
export function switchStatus(connected: number): string {
  if (connected === 0) return "On. No devices connected.";
  return `On. ${connected} ${connected === 1 ? "device" : "devices"} connected.`;
}

type RemoteControlProps = {
  pairing: PairingView;
  tab: "code" | "qr";
  endpoint: string;
  code: string;
  expires: string;
  left: number;
  qr: readonly string[];
  /** The reference of the paired mobile app. The row shows once `paired` is true. */
  device: string;
  paired: boolean;
};

export function RemoteControl({
  pairing,
  tab,
  endpoint,
  code,
  expires,
  left,
  qr,
  device,
  paired,
}: RemoteControlProps): ReactElement {
  return (
    <div className="rc-window">
      <div className="rc-content">
        <div className="rc-heading">
          <h3>Remote control</h3>
          <p>Use this computer from your phone or another computer.</p>
        </div>
        <div className="rc-switch-row">
          <span className="rc-switch-text">
            <strong>Enable Remote Control</strong>
            <span data-switch-status="">{switchStatus(paired ? 1 : 0)}</span>
          </span>
          <Switch checked />
        </div>
        <PairingPanel
          view={pairing}
          tab={tab}
          endpoint={endpoint}
          code={code}
          expires={expires}
          left={left}
          qr={qr}
        />
        <section className="rc-devices" data-devices={paired ? "one" : "none"}>
          <span className="rc-devices-head">
            <strong>Paired devices</strong>
            <span data-for="one">1 connected</span>
          </span>
          <p className="rc-devices-empty" data-for="none">
            No paired devices. Devices appear here after they connect with a code.
          </p>
          <span className="rc-device" data-for="one">
            <span className="rc-device-icon">
              <Smartphone />
              <i />
            </span>
            <span className="rc-device-text">
              <span>
                Mobile app <span className="rc-device-ref">{device}</span>
              </span>
              <span className="rc-device-status">Connected</span>
            </span>
            <Button size="sm" className="rc-remove">
              <Trash2 className="i16" />
              Remove
            </Button>
          </span>
          <p className="rc-devices-note" data-for="one">
            Names show the app type. They do not prove which device it is.
          </p>
        </section>
        <section className="rc-network">
          <span className="rc-network-text">
            <strong>Network</strong>
            <span>
              Other devices connect to <span className="rc-network-endpoint">{endpoint}</span>
            </span>
          </span>
          <Button variant="outline" size="sm">
            Change
          </Button>
        </section>
      </div>
    </div>
  );
}
