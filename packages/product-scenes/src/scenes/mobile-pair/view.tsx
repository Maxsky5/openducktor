// The mobile app pairs with the host. On the computer, Remote control is on, and the visitor
// selects Add device, then Scan a QR code. On the phone, the app shows Connect to a host. The
// visitor taps Scan QR code, and the camera reads the QR code on the computer. The app fills the
// address and the code, connects, shows the toast Connected to host, and opens the Sessions tab.
// The computer shows Device paired, and the phone joins Paired devices. Sources:
// settings-remote-access-section.tsx and pairing-panel.tsx in packages/frontend, and
// app/(setup)/index.tsx, add-host-form.tsx, and scan-host-screen.tsx in apps/mobile/src. The markup
// holds the last frame. A phone stage shows only the phone.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { MobileStage } from "../../replicas/mobile/MobileStage";
import { MobileToast } from "../../replicas/mobile/MobileToast";
import { PhoneFrame } from "../../replicas/mobile/PhoneFrame";
import { ScanScreen } from "../../replicas/mobile/ScanScreen";
import { SessionsTab } from "../../replicas/mobile/SessionsTab";
import { SetupScreen } from "../../replicas/mobile/SetupScreen";
import { Touch } from "../../replicas/mobile/Touch";
import { RemoteControl } from "../../replicas/settings/RemoteControl";
import { Pointer } from "../../replicas/shell/Pointer";
import {
  DEVICE_REFERENCE,
  HOST_ENDPOINT,
  PAIRING_CODE,
  PAIRING_QR,
  PHONE_SESSIONS,
} from "../../sample/mobile";
import { CONNECTED, expiry, OPENED_LEFT } from "./sample";
import "./view.css";

export function MobilePairView(props: SceneViewProps): ReactElement {
  const opened = expiry(OPENED_LEFT);
  return (
    <SceneFrame
      {...props}
      name="mobile-pair"
      alt={`The Remote control settings of the desktop app next to a phone with the OpenDucktor mobile app. Remote control is on. The developer selects Add device, and the panel Add a device shows the host address ${HOST_ENDPOINT} and a six-digit code. The developer selects the tab Scan a QR code, and a QR code shows with the time left of the code. The phone shows Connect to a host, with Scan QR code, the Host address field, and Continue. The user taps Scan QR code. The camera opens with the viewfinder and the hint Scan the host QR code, and the user points it at the QR code on the computer. The app reads the code, fills the address and the code, and shows Connecting. A toast says Connected to host, ${CONNECTED.description}. The phone opens the Sessions tab with the sessions of every open workspace. On the computer, the panel shows Device paired, the status says 1 device connected, and Paired devices lists the Mobile app as Connected.`}
    >
      <MobileStage
        lead={
          <RemoteControl
            pairing="paired"
            tab="qr"
            endpoint={HOST_ENDPOINT}
            code={PAIRING_CODE}
            expires={opened.text}
            left={opened.left}
            qr={PAIRING_QR}
            device={DEVICE_REFERENCE}
            paired
          />
        }
        phone={
          <PhoneFrame
            overlay={
              <>
                <MobileToast
                  kind="success"
                  message={CONNECTED.message}
                  description={CONNECTED.description}
                  toast="connected"
                  hidden
                />
                <Touch />
              </>
            }
          >
            <SetupScreen step="pairing" endpoint={HOST_ENDPOINT} code={PAIRING_CODE} hidden />
            <ScanScreen rows={PAIRING_QR} hidden />
            <SessionsTab entries={PHONE_SESSIONS} />
          </PhoneFrame>
        }
        overlay={<Pointer />}
      />
    </SceneFrame>
  );
}
