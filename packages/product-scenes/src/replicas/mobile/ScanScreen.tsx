// The camera screen that scans the host QR code, as scan-host-screen.tsx in apps/mobile/src/hosts:
// the camera view, the rounded corner guides of the viewfinder, the hint under it, and Close on a
// dark circle. The camera shows the screen of the computer with the QR code of Add device in its
// center. A scene moves `data-camera-view` so the center of `data-camera-screen` comes into the
// viewfinder.
import { X } from "lucide-react";
import type { ReactElement } from "react";
import { QrCode } from "../ui/QrCode";
import { MobileScreen } from "./MobileScreen";
import "./ScanScreen.css";

/** The hint over the camera. */
export const SCAN_HINT = {
  title: "Scan the host QR code",
  detail: "On your computer, open Settings, Remote control, and show the QR code.",
} as const;

export function ScanScreen({
  rows,
  hidden,
}: {
  /** The module rows of the QR code on the computer. */
  rows: readonly string[];
  hidden?: boolean | undefined;
}): ReactElement {
  return (
    <MobileScreen id="scan" background="camera" over hidden={hidden}>
      <div className="mob-camera">
        <div className="mob-camera-view" data-camera-view="">
          <div className="mob-camera-laptop">
            <div className="mob-camera-screen" data-camera-screen="">
              <QrCode rows={rows} className="mob-camera-qr" />
            </div>
          </div>
        </div>
      </div>
      <div className="mob-scan-overlay">
        <span className="mob-viewfinder" data-viewfinder="">
          <i data-corner="top-left" />
          <i data-corner="top-right" />
          <i data-corner="bottom-left" />
          <i data-corner="bottom-right" />
        </span>
        <span className="mob-scan-hint">
          <strong>{SCAN_HINT.title}</strong>
          <span>{SCAN_HINT.detail}</span>
        </span>
      </div>
      <span className="mob-scan-close">
        <X />
      </span>
    </MobileScreen>
  );
}
